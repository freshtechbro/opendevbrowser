import { describe, expect, it, vi } from "vitest";
import {
  MIN_PIN_MEDIA_EVIDENCE_BYTES,
  MIN_PIN_MEDIA_EVIDENCE_HEIGHT,
  MIN_PIN_MEDIA_EVIDENCE_WIDTH,
  buildInspiredesignPinterestPinMediaIndexEntry,
  classifyInspiredesignPinterestPinMediaAuthority,
  buildPinterestPinMediaEvidenceArtifactRoot,
  buildPinterestPinMediaEvidenceArtifactPath,
  extensionForPinterestPinMediaContentType,
  hashPinterestPinMediaEvidenceBuffer,
  hasPinterestPinMediaAuthorityBlockingWarning,
  hasPinterestPinMediaBlockingWarning,
  inspectPinterestPinMediaBuffer,
  isFirstPartyPinterestPinMediaUrl,
  persistInspiredesignPinterestPinMediaEvidence,
  sanitizeInspiredesignPinterestPinMediaReferenceId,
  verifyPinterestPinMediaPersistedBytes,
  type InspiredesignPersistedPinterestPinMediaEvidence,
  type InspiredesignPinterestPinMediaRuntimeMetadata
} from "../src/inspiredesign/pinterest-pin-media-evidence";
import type { PinterestSourcePageQuality } from "../src/inspiredesign/pinterest-media-classification";

const makeJpegBytes = (width: number, height: number, minBytes = MIN_PIN_MEDIA_EVIDENCE_BYTES + 1): Buffer => {
  const header = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, minBytes - header.length), 0)]);
};
const makePngBytes = (width: number, height: number, minBytes = MIN_PIN_MEDIA_EVIDENCE_BYTES + 1): Buffer => {
  const header = Buffer.alloc(33, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 2;
  return Buffer.concat([header, Buffer.alloc(Math.max(0, minBytes - header.length), 0)]);
};
const makeGifBytes = (
  width: number,
  height: number,
  signature = "GIF89a",
  minBytes = MIN_PIN_MEDIA_EVIDENCE_BYTES + 1
): Buffer => {
  const header = Buffer.alloc(10, 0);
  header.write(signature, 0, "ascii");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, minBytes - header.length), 0)]);
};

type Mp4FixtureDimensions = {
  width: number;
  height: number;
};

const DEFAULT_MP4_FIXTURE_DIMENSIONS: Mp4FixtureDimensions = { width: 720, height: 1280 };
const MP4_FIXED_POINT_SCALE = 65_536;
const MP4_TKHD_BOX_BYTES = 92;
const MP4_TKHD_VERSION_0_WIDTH_OFFSET = 84;
const MP4_TKHD_VERSION_0_HEIGHT_OFFSET = 88;

const makeMp4Box = (type: string, payload: Buffer): Buffer => {
  const box = Buffer.alloc(8 + payload.length, 0);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, "ascii");
  payload.copy(box, 8);
  return box;
};

const makeMp4TkhdBox = (dimensions: Mp4FixtureDimensions): Buffer => {
  const payload = Buffer.alloc(MP4_TKHD_BOX_BYTES, 0);
  payload.write("tkhd", 4, "ascii");
  payload.writeUInt32BE(dimensions.width * MP4_FIXED_POINT_SCALE, MP4_TKHD_VERSION_0_WIDTH_OFFSET);
  payload.writeUInt32BE(dimensions.height * MP4_FIXED_POINT_SCALE, MP4_TKHD_VERSION_0_HEIGHT_OFFSET);
  payload.writeUInt32BE(payload.length, 0);
  return payload;
};

const makeMp4Bytes = (
  dimensions: Mp4FixtureDimensions | null = DEFAULT_MP4_FIXTURE_DIMENSIONS,
  minBytes = MIN_PIN_MEDIA_EVIDENCE_BYTES + 1
): Buffer => {
  const ftyp = Buffer.alloc(24, 0);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftyp", 4, "ascii");
  ftyp.write("isom", 8, "ascii");
  ftyp.write("iso2", 12, "ascii");
  ftyp.write("avc1", 16, "ascii");
  ftyp.write("mp41", 20, "ascii");
  const mediaBoxes = dimensions ? [ftyp, makeMp4Box("moov", makeMp4Box("trak", makeMp4TkhdBox(dimensions)))] : [ftyp];
  const media = Buffer.concat(mediaBoxes);
  return Buffer.concat([media, Buffer.alloc(Math.max(0, minBytes - media.length), 0)]);
};

const makeMp4BytesWithoutDimensions = (): Buffer => makeMp4Bytes(
  null,
  MIN_PIN_MEDIA_EVIDENCE_BYTES + 1
);

const writeUInt24LE = (buffer: Buffer, value: number, offset: number): void => {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
};

const makeWebpVp8xBytes = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES + 1, 0);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  writeUInt24LE(buffer, width - 1, 24);
  writeUInt24LE(buffer, height - 1, 27);
  return buffer;
};

const makeWebpVp8Bytes = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES + 1, 0);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
};

	const makeWebpVp8lBytes = (width: number, height: number): Buffer => {
	  const buffer = Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES + 1, 0);
	  buffer.write("RIFF", 0, "ascii");
	  buffer.write("WEBP", 8, "ascii");
	  buffer.write("VP8L", 12, "ascii");
	  buffer[20] = 0x2f;
	  buffer.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
	  return buffer;
	};

	const makeWebpVp8lWithoutSignatureBytes = (): Buffer => {
	  const buffer = Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES + 1, 0);
	  buffer.write("RIFF", 0, "ascii");
	  buffer.write("WEBP", 8, "ascii");
	  buffer.write("VP8L", 12, "ascii");
	  buffer.writeUInt32LE((640 - 1) | ((480 - 1) << 14), 21);
	  return buffer;
	};

	const makeAvifBytes = (width: number, height: number, includeIspe = true, brand = "avif"): Buffer => {
	  const buffer = Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES + 1, 0);
	  buffer.write("ftyp", 4, "ascii");
	  buffer.write(brand, 8, "ascii");
	  if (includeIspe) {
	    buffer.write("ispe", 32, "ascii");
	    buffer.writeUInt32BE(width, 40);
    buffer.writeUInt32BE(height, 44);
  }
  return buffer;
};
const validBytes = makeJpegBytes(1200, 1600);
const validSha256 = hashPinterestPinMediaEvidenceBuffer(validBytes);
const referenceUrl = "https://www.pinterest.com/pin/1234567890/";
const mediaUrl = "https://i.pinimg.com/originals/aa/bb/cc/reference.jpg";
const videoMediaUrl = "https://v.pinimg.com/videos/mc/720p/reference.mp4";
const edgeVideoMediaUrl = "https://v1-e.pinimg.com/videos/mc/720p/87/6b/16/reference.mp4";

const makeRuntime = (
  overrides: Partial<InspiredesignPinterestPinMediaRuntimeMetadata> = {}
): InspiredesignPinterestPinMediaRuntimeMetadata => ({
  status: "captured",
  kind: "image",
  capturedAt: "2026-05-27T12:00:00.000Z",
  referenceId: "pin 1234567890",
  url: referenceUrl,
  sourceUrl: `${referenceUrl}?tracking=1`,
  pinterestPageQuality: "pin_media",
  mediaUrl,
  candidateSelector: "[data-test-id='closeup-image-main-MainPinImage'] img",
  candidateRole: "img",
  candidateAlt: "Editorial outfit reference",
  width: 1200,
  height: 1600,
  contentType: "image/jpeg; charset=binary",
  warnings: [],
  rejectionReasons: [],
  ...overrides
});

const persistValidEvidence = (
  overrides: Partial<InspiredesignPinterestPinMediaRuntimeMetadata> = {},
  artifactPath = buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"),
  buffer = validBytes
) => persistInspiredesignPinterestPinMediaEvidence(makeRuntime(overrides), {
  artifactPath,
  sha256: hashPinterestPinMediaEvidenceBuffer(buffer),
  bytes: buffer.length,
  buffer
});

describe("Pinterest pin media evidence helpers", () => {
  it("sanitizes reference IDs and builds image and video poster paths", () => {
    expect(sanitizeInspiredesignPinterestPinMediaReferenceId(" ../../Pin 123? ")).toBe("Pin-123");
    expect(sanitizeInspiredesignPinterestPinMediaReferenceId("...")).toBe("reference");
    expect(buildPinterestPinMediaEvidenceArtifactPath("Pin 123", "image", "webp"))
      .toBe("pin-media-evidence/Pin-123/main.webp");
    expect(buildPinterestPinMediaEvidenceArtifactPath("Pin 123", "video_poster", "jpg"))
      .toBe("pin-media-evidence/Pin-123/poster.jpg");
    expect(buildPinterestPinMediaEvidenceArtifactPath("Pin 123", "video", "mp4"))
      .toBe("pin-media-evidence/Pin-123/video.mp4");
    expect(extensionForPinterestPinMediaContentType("image/png")).toBe("png");
    expect(extensionForPinterestPinMediaContentType("video/mp4")).toBe("mp4");
  });

  it("rejects hostile artifact paths without leaking temp paths", () => {
    const persisted = persistInspiredesignPinterestPinMediaEvidence(makeRuntime({
      tempPath: "/tmp/private/pin.jpg",
      failure: "read /tmp/private/pin.jpg failed"
    }), {
      artifactPath: "../outside/pin.jpg",
      sha256: validSha256,
      bytes: validBytes.length
    });

    expect(persisted.path).toBeUndefined();
    expect(persisted.authority).toBe("diagnostic");
    expect(persisted.rejectionReasons).toContain("missing_artifact_path");
    expect(JSON.stringify(persisted)).not.toContain("/tmp/private");
  });

  it("validates first-party Pinterest media URLs", () => {
    expect(isFirstPartyPinterestPinMediaUrl(mediaUrl)).toBe(true);
    expect(isFirstPartyPinterestPinMediaUrl(videoMediaUrl)).toBe(true);
    expect(isFirstPartyPinterestPinMediaUrl(edgeVideoMediaUrl)).toBe(true);
    expect(isFirstPartyPinterestPinMediaUrl("http://i.pinimg.com/originals/a.jpg")).toBe(false);
    expect(isFirstPartyPinterestPinMediaUrl("https://cdn.pinimg.com/videos/a.mp4")).toBe(false);
    expect(isFirstPartyPinterestPinMediaUrl("https://v1evil.pinimg.com/videos/a.mp4")).toBe(false);
    expect(isFirstPartyPinterestPinMediaUrl("https://cdn.pinimg.com/originals/a.jpg")).toBe(false);
    expect(isFirstPartyPinterestPinMediaUrl("https://example.com/originals/a.jpg")).toBe(false);

    const persisted = persistValidEvidence({ mediaUrl: "https://example.com/reference.jpg" });
    expect(persisted.mediaUrl).toBeUndefined();
    expect(persisted.authority).toBe("diagnostic");
    expect(persisted.rejectionReasons).toContain("media_url_not_first_party");
  });

  it("hashes and verifies persisted bytes", () => {
    const persisted = persistValidEvidence();
    expect(persisted.authority).toBe("design_evidence");
    expect(hashPinterestPinMediaEvidenceBuffer(validBytes)).toBe(validSha256);
    expect(verifyPinterestPinMediaPersistedBytes(persisted, validBytes)).toEqual({
      ok: true,
      sha256: validSha256,
      bytes: validBytes.length,
      reasons: []
    });
    expect(verifyPinterestPinMediaPersistedBytes(persisted, undefined)).toEqual({
      ok: false,
      reasons: ["missing_bytes"]
    });
    expect(verifyPinterestPinMediaPersistedBytes({ ...persisted, sha256: "abc" }, validBytes).reasons)
      .toContain("invalid_sha256");
    expect(verifyPinterestPinMediaPersistedBytes({ ...persisted, sha256: "f".repeat(64) }, validBytes).reasons)
      .toContain("sha256_mismatch");
  });

  it("demotes invalid sha256 and missing bytes", () => {
    const invalidHash = persistInspiredesignPinterestPinMediaEvidence(makeRuntime(), {
      artifactPath: buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"),
      sha256: "abc123",
      bytes: validBytes.length
    });
    expect(invalidHash.authority).toBe("diagnostic");
    expect(invalidHash.rejectionReasons).toContain("invalid_sha256");

    const missingHash = persistInspiredesignPinterestPinMediaEvidence(makeRuntime(), {
      artifactPath: buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"),
      bytes: validBytes.length
    });
    expect(missingHash.authority).toBe("diagnostic");
    expect(missingHash.rejectionReasons).toContain("invalid_sha256");

    const missingBytes = persistInspiredesignPinterestPinMediaEvidence(makeRuntime(), {
      artifactPath: buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"),
      sha256: validSha256
    });
    expect(missingBytes.authority).toBe("diagnostic");
    expect(missingBytes.rejectionReasons).toContain("missing_bytes");
  });

  it("validates dimensions and content type before granting design authority", () => {
    const tinyBytes = makeJpegBytes(200, 240);
    const tiny = persistValidEvidence({ width: 200, height: 240 }, buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"), tinyBytes);
    expect(tiny.authority).toBe("diagnostic");
    expect(tiny.rejectionReasons).toContain("dimensions_below_minimum");

    const mismatchedContentType = persistValidEvidence({ contentType: "video/mp4" });
    expect(mismatchedContentType.authority).toBe("diagnostic");
    expect(mismatchedContentType.rejectionReasons).toContain("content_type_mismatch");
  });

  it("sniffs supported image byte signatures and malformed dimension branches", () => {
    expect(inspectPinterestPinMediaBuffer(undefined)).toEqual({ reasons: ["missing_bytes"] });
    expect(inspectPinterestPinMediaBuffer(Buffer.alloc(0))).toEqual({ reasons: ["missing_bytes"] });
    expect(inspectPinterestPinMediaBuffer(Buffer.alloc(12))).toMatchObject({
      reasons: expect.arrayContaining(["unsupported_byte_signature", "missing_dimensions"])
    });

    const pngWithoutIhdr = makePngBytes(1200, 1600);
    pngWithoutIhdr.write("IDAT", 12, "ascii");
    expect(inspectPinterestPinMediaBuffer(pngWithoutIhdr)).toMatchObject({
      contentType: "image/png",
      extension: "png",
      reasons: expect.arrayContaining(["missing_dimensions"])
    });
    expect(inspectPinterestPinMediaBuffer(makeGifBytes(640, 480, "GIF87a"))).toMatchObject({
      contentType: "image/gif",
      extension: "gif",
      width: 640,
      height: 480,
      reasons: []
    });
    expect(inspectPinterestPinMediaBuffer(makeGifBytes(640, 480, "GIF00a"))).toMatchObject({
      reasons: expect.arrayContaining(["unsupported_byte_signature", "missing_dimensions"])
    });

    const jpegWithNoiseAndRestart = Buffer.from([
      0xff, 0xd8,
      0x00,
      0xff, 0xd0,
      0xff, 0xc0, 0x00, 0x11, 0x08,
      0x02, 0x58,
      0x03, 0x20,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00
    ]);
    expect(inspectPinterestPinMediaBuffer(jpegWithNoiseAndRestart)).toMatchObject({
      contentType: "image/jpeg",
      width: 800,
      height: 600,
      reasons: []
    });
    expect(inspectPinterestPinMediaBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]))).toMatchObject({
      contentType: "image/jpeg",
      reasons: expect.arrayContaining(["missing_dimensions"])
    });
    expect(inspectPinterestPinMediaBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08]))).toMatchObject({
      contentType: "image/jpeg",
      reasons: expect.arrayContaining(["missing_dimensions"])
    });

    expect(inspectPinterestPinMediaBuffer(makeWebpVp8xBytes(1024, 768))).toMatchObject({
      contentType: "image/webp",
      extension: "webp",
      width: 1024,
      height: 768,
      reasons: []
    });
    expect(inspectPinterestPinMediaBuffer(makeWebpVp8Bytes(640, 480))).toMatchObject({
      contentType: "image/webp",
      width: 640,
      height: 480,
      reasons: []
    });
	    expect(inspectPinterestPinMediaBuffer(makeWebpVp8lBytes(641, 481))).toMatchObject({
	      contentType: "image/webp",
	      width: 641,
	      height: 481,
	      reasons: []
	    });
	    expect(inspectPinterestPinMediaBuffer(makeWebpVp8lWithoutSignatureBytes())).toMatchObject({
	      contentType: "image/webp",
	      reasons: expect.arrayContaining(["missing_dimensions"])
	    });
	    const webpWithoutDimensions = Buffer.alloc(20, 0);
	    webpWithoutDimensions.write("RIFF", 0, "ascii");
	    webpWithoutDimensions.write("WEBP", 8, "ascii");
    webpWithoutDimensions.write("VP8X", 12, "ascii");
    expect(inspectPinterestPinMediaBuffer(webpWithoutDimensions)).toMatchObject({
      contentType: "image/webp",
      reasons: expect.arrayContaining(["missing_dimensions"])
    });
    const riffWithoutWebp = Buffer.alloc(20, 0);
    riffWithoutWebp.write("RIFF", 0, "ascii");
    riffWithoutWebp.write("WXYZ", 8, "ascii");
    expect(inspectPinterestPinMediaBuffer(riffWithoutWebp)).toMatchObject({
      reasons: expect.arrayContaining(["unsupported_byte_signature", "missing_dimensions"])
    });

	    expect(inspectPinterestPinMediaBuffer(makeAvifBytes(900, 700))).toMatchObject({
	      contentType: "image/avif",
	      extension: "avif",
	      width: 900,
	      height: 700,
	      reasons: []
	    });
	    expect(inspectPinterestPinMediaBuffer(makeAvifBytes(901, 701, true, "avis"))).toMatchObject({
	      contentType: "image/avif",
	      extension: "avif",
	      width: 901,
	      height: 701,
	      reasons: []
	    });
    expect(inspectPinterestPinMediaBuffer(makeAvifBytes(900, 700, false))).toMatchObject({
      contentType: "image/avif",
      reasons: expect.arrayContaining(["missing_dimensions"])
    });
    const ftypWithoutAvifBrand = makeAvifBytes(900, 700, false);
    ftypWithoutAvifBrand.write("mif1", 8, "ascii");
    expect(inspectPinterestPinMediaBuffer(ftypWithoutAvifBrand)).toMatchObject({
      reasons: expect.arrayContaining(["unsupported_byte_signature", "missing_dimensions"])
    });

    expect(inspectPinterestPinMediaBuffer(makeMp4Bytes())).toMatchObject({
      contentType: "video/mp4",
      extension: "mp4",
      width: 720,
      height: 1280,
      reasons: []
    });
	    expect(inspectPinterestPinMediaBuffer(makeMp4BytesWithoutDimensions())).toMatchObject({
	      contentType: "video/mp4",
	      extension: "mp4",
	      reasons: expect.arrayContaining(["missing_dimensions"])
	    });
	    const mp4WithTopLevelTkhd = Buffer.concat([
	      makeMp4BytesWithoutDimensions().subarray(0, 24),
	      makeMp4TkhdBox(DEFAULT_MP4_FIXTURE_DIMENSIONS),
	      Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES + 1)
	    ]);
	    expect(inspectPinterestPinMediaBuffer(mp4WithTopLevelTkhd)).toMatchObject({
	      contentType: "video/mp4",
	      extension: "mp4",
	      reasons: expect.arrayContaining(["missing_dimensions"])
	    });
	    expect(inspectPinterestPinMediaBuffer(mp4WithTopLevelTkhd).width).toBeUndefined();
	    const ftypWithoutMp4Brand = makeMp4Bytes();
	    ftypWithoutMp4Brand.write("zzzz", 8, "ascii");
    ftypWithoutMp4Brand.write("yyyy", 12, "ascii");
    ftypWithoutMp4Brand.write("xxxx", 16, "ascii");
    ftypWithoutMp4Brand.write("wwww", 20, "ascii");
    expect(inspectPinterestPinMediaBuffer(ftypWithoutMp4Brand)).toMatchObject({
      reasons: expect.arrayContaining(["unsupported_byte_signature", "missing_dimensions"])
    });
  });

  it("demotes blocking warnings and explicit rejection reasons", () => {
    const blocked = persistValidEvidence({ warnings: ["login challenge overlay blocked main media"] });
    expect(blocked.authority).toBe("diagnostic");
    expect(blocked.rejectionReasons).toContain("blocking_warning");

    const rejected = persistValidEvidence({ rejectionReasons: ["related_pin_candidate"] });
    expect(rejected.authority).toBe("diagnostic");
    expect(rejected.rejectionReasons).toContain("related_pin_candidate");
  });

	it("keeps trusted canonical interface chrome pin media authoritative", () => {
	const persisted = persistValidEvidence({ warnings: ["interface_chrome_shell"] });
	const indexEntry = buildInspiredesignPinterestPinMediaIndexEntry(persisted);

	expect(persisted.authority).toBe("design_evidence");
	expect(persisted.rejectionReasons).not.toContain("blocking_warning");
	expect(persisted.rejectionReasons).not.toContain("missing_trusted_byte_inspection");
	expect(indexEntry).toEqual(expect.objectContaining({
		referenceId: "pin-1234567890",
		authority: "design_evidence",
		warnings: ["interface_chrome_shell"]
	}));
	});

	it("does not delete caller-supplied blocking warning reasons for interface chrome media", () => {
	const persisted = persistValidEvidence({
		warnings: ["interface_chrome_shell"],
		rejectionReasons: ["blocking_warning"]
	});

	expect(persisted.authority).toBe("diagnostic");
	expect(persisted.rejectionReasons).toContain("blocking_warning");
	expect(buildInspiredesignPinterestPinMediaIndexEntry(persisted)).toBeUndefined();
	});

	it("keeps interface chrome warning authority checks strict for malformed inputs", () => {
	expect(hasPinterestPinMediaAuthorityBlockingWarning({
		warnings: ["interface_chrome_shell"]
	})).toBe(true);
	expect(hasPinterestPinMediaAuthorityBlockingWarning({
		warnings: ["interface_chrome_shell"],
		firstPartyProvenance: []
	})).toBe(true);
	expect(hasPinterestPinMediaAuthorityBlockingWarning({
		warnings: "interface_chrome_shell"
	})).toBe(false);
	const serializedVideoIndex = {
		authority: "design_evidence",
		kind: "video",
		referenceId: "pin-1234567890",
		url: referenceUrl,
		sourceUrl: referenceUrl,
		pinterestPageQuality: "pin_media",
		mediaUrl: videoMediaUrl,
		path: "pin-media-evidence/pin-1234567890/video.mp4",
		sha256: "a".repeat(64),
		bytes: MIN_PIN_MEDIA_EVIDENCE_BYTES + 1,
		width: 720,
		height: 1280,
		contentType: "video/mp4",
		warnings: ["interface_chrome_shell"],
		firstPartyProvenance: {
			canonicalReferenceUrl: referenceUrl,
			canonicalSourceUrl: referenceUrl,
			referenceUrlCanonical: true,
			sourceUrlMatchesReference: true,
			mediaUrlFirstParty: true
		}
	};
	expect(hasPinterestPinMediaAuthorityBlockingWarning(serializedVideoIndex)).toBe(false);
	expect(hasPinterestPinMediaAuthorityBlockingWarning({
		...serializedVideoIndex,
		path: "pin-media-evidence/pin-1234567890/main.mp4"
	})).toBe(true);
	});

	it.each([
	"search_shell",
	"chrome_only",
	"promoted",
	"ad",
	"pin_media_noise:ad",
	"pin_media_noise:ad_shopping",
	"captcha",
	"challenge_overlay_blocked"
	])("keeps %s warnings fatal for byte-backed pin media", (warning) => {
	const persisted = persistValidEvidence({ warnings: [warning] });

	expect(persisted.authority).toBe("diagnostic");
	expect(persisted.rejectionReasons).toContain("blocking_warning");
	expect(buildInspiredesignPinterestPinMediaIndexEntry(persisted)).toBeUndefined();
	});

  it("sanitizes invalid URLs, timestamps, page quality, and unsafe optional metadata", () => {
    const invalidKind = "animated_gif" as InspiredesignPinterestPinMediaRuntimeMetadata["kind"];
    const invalidPageQuality = "pin_story" as PinterestSourcePageQuality;
    const persisted = persistInspiredesignPinterestPinMediaEvidence(makeRuntime({
      kind: invalidKind,
      capturedAt: "not-a-date",
      referenceId: `${"p".repeat(96)}safe-tail`,
      url: "not a url",
      sourceUrl: "mailto:pin@example.test",
      startedSourceUrl: "ftp://www.pinterest.com/pin/1234567890/",
      endedSourceUrl: "http://www.pinterest.com/pin/1234567890/?tracking=1",
      pinterestPageQuality: invalidPageQuality,
      mediaUrl: "not a media url",
      candidateSelector: "data:image/png;base64,AAAA",
      candidateRole: "  main image  ",
      candidateAlt: "long alt ".repeat(60),
      width: Number.NaN,
      height: -1,
      contentType: undefined,
      warnings: undefined,
      rejectionReasons: undefined
    }), {
      artifactPath: buildPinterestPinMediaEvidenceArtifactPath("p".repeat(96), "image", "jpg"),
      sha256: validSha256,
      bytes: validBytes.length
    });

    expect(persisted.kind).toBe("image");
    expect(persisted.capturedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(persisted.referenceId).toBe("p".repeat(96));
    expect(persisted.url).toBe("");
    expect(persisted.sourceUrl).toBeUndefined();
    expect(persisted.startedSourceUrl).toBeUndefined();
    expect(persisted.endedSourceUrl).toBe("http://www.pinterest.com/pin/1234567890/?tracking=1");
    expect(persisted.pinterestPageQuality).toBeUndefined();
    expect(persisted.mediaUrl).toBeUndefined();
    expect(persisted.candidateSelector).toBeUndefined();
    expect(persisted.candidateRole).toBe("main image");
    expect(persisted.candidateAlt).toHaveLength(360);
    expect(persisted.width).toBeUndefined();
    expect(persisted.height).toBeUndefined();
    expect(persisted.contentType).toBeUndefined();
    expect(persisted.warnings).toEqual([]);
    expect(persisted.rejectionReasons).toEqual(expect.arrayContaining([
      "invalid_reference_url",
      "missing_source_url",
      "media_url_not_first_party",
      "page_quality_not_pin_media",
      "missing_dimensions",
      "unsupported_content_type"
    ]));

    const blankCapturedAt = persistValidEvidence({ capturedAt: "   " });
    expect(blankCapturedAt.capturedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(isFirstPartyPinterestPinMediaUrl("not a url")).toBe(false);
  });

  it("keeps sanitized http source diagnostics without granting source authority", () => {
    const sourceMismatch = persistValidEvidence({
      sourceUrl: "http://www.pinterest.com/pin/2222222222/",
      startedSourceUrl: "http://www.pinterest.com/pin/2222222222/?tracking=1",
      endedSourceUrl: "https://www.pinterest.com/pin/2222222222/"
    });

    expect(sourceMismatch.sourceUrl).toBe("http://www.pinterest.com/pin/2222222222/");
    expect(sourceMismatch.startedSourceUrl).toBe("http://www.pinterest.com/pin/2222222222/?tracking=1");
    expect(sourceMismatch.endedSourceUrl).toBe("https://www.pinterest.com/pin/2222222222/");
    expect(sourceMismatch.firstPartyProvenance.canonicalReferenceUrl).toBe(referenceUrl);
    expect(sourceMismatch.firstPartyProvenance.canonicalSourceUrl).toBeUndefined();
    expect(sourceMismatch.firstPartyProvenance.sourceUrlMatchesReference).toBe(false);
    expect(sourceMismatch.authority).toBe("diagnostic");
    expect(sourceMismatch.rejectionReasons).toContain("source_url_mismatch");

    const nonWwwSource = persistValidEvidence({ sourceUrl: "https://pinterest.com/pin/1234567890/" });
    expect(nonWwwSource.firstPartyProvenance.canonicalSourceUrl).toBe(referenceUrl);
    expect(nonWwwSource.authority).toBe("design_evidence");

    const httpReference = persistValidEvidence({ url: "http://www.pinterest.com/pin/1234567890/" });
    expect(httpReference.firstPartyProvenance.canonicalReferenceUrl).toBeUndefined();
    expect(httpReference.authority).toBe("diagnostic");
    expect(httpReference.rejectionReasons).toContain("invalid_reference_url");

    const missingSource = persistValidEvidence({ sourceUrl: undefined });
    expect(missingSource.sourceUrl).toBeUndefined();
    expect(missingSource.rejectionReasons).toContain("missing_source_url");
  });

  it("records skipped and failed capture statuses as diagnostic without artifact paths", () => {
    const skipped = persistValidEvidence({ status: "skipped" });
    expect(skipped.status).toBe("skipped");
    expect(skipped.path).toBeUndefined();
    expect(skipped.authority).toBe("diagnostic");
    expect(skipped.rejectionReasons).toEqual(expect.arrayContaining([
      "status_skipped",
      "missing_artifact_path"
    ]));

    const failed = persistValidEvidence({
      status: "failed",
      failure: "selector timed out before media candidate"
    });
    expect(failed.status).toBe("failed");
    expect(failed.failure).toBe("selector timed out before media candidate");
    expect(failed.path).toBeUndefined();
    expect(failed.rejectionReasons).toContain("status_failed");
  });

  it("demotes below-threshold bytes and detects byte count mismatches", () => {
    const smallBytes = persistInspiredesignPinterestPinMediaEvidence(makeRuntime(), {
      artifactPath: buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"),
      sha256: validSha256,
      bytes: MIN_PIN_MEDIA_EVIDENCE_BYTES - 1
    });
    expect(smallBytes.authority).toBe("diagnostic");
    expect(smallBytes.rejectionReasons).toContain("bytes_below_minimum");

    const persisted = persistValidEvidence();
    expect(verifyPinterestPinMediaPersistedBytes({
      ...persisted,
      bytes: validBytes.length + 1
    }, validBytes).reasons).toContain("byte_count_mismatch");

    const tinyBuffer = Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES - 1, "x");
    expect(verifyPinterestPinMediaPersistedBytes({
      ...persisted,
      sha256: hashPinterestPinMediaEvidenceBuffer(tinyBuffer),
      bytes: tinyBuffer.length
    }, tinyBuffer)).toEqual({
      ok: false,
      sha256: hashPinterestPinMediaEvidenceBuffer(tinyBuffer),
      bytes: tinyBuffer.length,
      reasons: ["bytes_below_minimum"]
    });
  });

  it("normalizes page quality, dimensions, and blocking warning edge cases", () => {
    const gridPage = persistValidEvidence({ pinterestPageQuality: "pin_grid_media" });
    expect(gridPage.pinterestPageQuality).toBe("pin_grid_media");
    expect(gridPage.authority).toBe("diagnostic");
    expect(gridPage.rejectionReasons).toContain("page_quality_not_pin_media");

    const missingDimensions = persistInspiredesignPinterestPinMediaEvidence(makeRuntime({
      width: undefined,
      height: undefined
    }), {
      artifactPath: buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"),
      sha256: validSha256,
      bytes: validBytes.length
    });
    expect(missingDimensions.rejectionReasons).toContain("missing_dimensions");

    const lowWidthBytes = makeJpegBytes(MIN_PIN_MEDIA_EVIDENCE_WIDTH - 1, MIN_PIN_MEDIA_EVIDENCE_HEIGHT);
    const lowHeightBytes = makeJpegBytes(MIN_PIN_MEDIA_EVIDENCE_WIDTH, MIN_PIN_MEDIA_EVIDENCE_HEIGHT - 1);
    const lowWidth = persistValidEvidence({
      width: MIN_PIN_MEDIA_EVIDENCE_WIDTH - 1,
      height: MIN_PIN_MEDIA_EVIDENCE_HEIGHT
    }, buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"), lowWidthBytes);
    const lowHeight = persistValidEvidence({
      width: MIN_PIN_MEDIA_EVIDENCE_WIDTH,
      height: MIN_PIN_MEDIA_EVIDENCE_HEIGHT - 1
    }, buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"), lowHeightBytes);
    expect(lowWidth.rejectionReasons).toContain("dimensions_below_minimum");
    expect(lowHeight.rejectionReasons).toContain("dimensions_below_minimum");
    expect(hasPinterestPinMediaBlockingWarning(["decorative caption only"])).toBe(false);
    expect(hasPinterestPinMediaBlockingWarning(["promoted related pin ad"])).toBe(true);
  });

  it("omits optional candidate metadata from index entries when absent", () => {
    const persisted = persistValidEvidence({
      candidateSelector: undefined,
      candidateRole: undefined,
      candidateAlt: undefined
    });
    const indexEntry = buildInspiredesignPinterestPinMediaIndexEntry(persisted);

    expect(indexEntry).toMatchObject({
      referenceId: "pin-1234567890",
      authority: "design_evidence",
      path: "pin-media-evidence/pin-1234567890/main.jpg"
    });
    expect(indexEntry).not.toHaveProperty("candidateSelector");
    expect(indexEntry).not.toHaveProperty("candidateRole");
    expect(indexEntry).not.toHaveProperty("candidateAlt");
  });

  it("uses trusted persisted metadata as the default persistence input", () => {
    const persisted = persistValidEvidence();
    const roundTrip = persistInspiredesignPinterestPinMediaEvidence(persisted);

    expect(roundTrip.authority).toBe("design_evidence");
    expect(roundTrip.path).toBe("pin-media-evidence/pin-1234567890/main.jpg");
    expect(roundTrip.sha256).toBe(validSha256);
    expect(roundTrip.bytes).toBe(validBytes.length);
  });

  it("demotes forged design evidence without trusted byte inspection", () => {
    const forged: InspiredesignPersistedPinterestPinMediaEvidence = {
      ...persistValidEvidence(),
      authority: "design_evidence"
    };
    const normalized = persistInspiredesignPinterestPinMediaEvidence(forged);

    expect(normalized.authority).toBe("diagnostic");
    expect(normalized.rejectionReasons).toContain("missing_trusted_byte_inspection");
  });

  it("demotes JSON-round-tripped design evidence after trusted marker serialization loss", () => {
    const persisted = persistValidEvidence();
    const serialized = JSON.parse(JSON.stringify(persisted)) as InspiredesignPersistedPinterestPinMediaEvidence;
    const normalized = persistInspiredesignPinterestPinMediaEvidence(serialized);

    expect(normalized.authority).toBe("diagnostic");
    expect(normalized.rejectionReasons).toContain("missing_trusted_byte_inspection");
  });

  it("demotes trusted design evidence when a signed field is mutated", () => {
    const persisted = persistValidEvidence();
    persisted.sha256 = "b".repeat(64);
    const normalized = persistInspiredesignPinterestPinMediaEvidence(persisted);

    expect(normalized.authority).toBe("diagnostic");
    expect(normalized.rejectionReasons).toContain("missing_trusted_byte_inspection");
  });

  it("keeps interface chrome shell blocking when strict kind or content type shape is invalid", () => {
    const trusted = persistValidEvidence();
    const warningInput = {
      ...trusted,
      warnings: ["interface_chrome_shell"]
    };

    expect(hasPinterestPinMediaAuthorityBlockingWarning({
      ...warningInput,
      kind: "animated"
    })).toBe(true);
    expect(hasPinterestPinMediaAuthorityBlockingWarning({
      ...warningInput,
      contentType: "text/plain"
    })).toBe(true);
  });

  it("guards forged design index entries with missing required fields", () => {
    const persisted = persistValidEvidence();
    const missingSource: InspiredesignPersistedPinterestPinMediaEvidence = {
      ...persisted,
      authority: "design_evidence",
      sourceUrl: undefined
    };
    const missingBytes: InspiredesignPersistedPinterestPinMediaEvidence = {
      ...persisted,
      authority: "design_evidence",
      bytes: undefined
    };

    expect(buildInspiredesignPinterestPinMediaIndexEntry(missingSource)).toBeUndefined();
    expect(buildInspiredesignPinterestPinMediaIndexEntry(missingBytes)).toBeUndefined();
    expect(buildPinterestPinMediaEvidenceArtifactRoot(" ../../Pin 123? ")).toBe("pin-media-evidence/Pin-123");
  });

  it("normalizes allowed Pinterest pin hosts to canonical www pin URLs", () => {
    const bareHost = persistValidEvidence({
      url: "https://pinterest.com/pin/1234567890/?tracking=1",
      sourceUrl: "https://pinterest.com/pin/1234567890/"
    });
    expect(bareHost.authority).toBe("design_evidence");
    expect(bareHost.firstPartyProvenance.canonicalReferenceUrl).toBe(referenceUrl);
    expect(bareHost.firstPartyProvenance.canonicalSourceUrl).toBe(referenceUrl);
    expect(bareHost.firstPartyProvenance.sourceUrlMatchesReference).toBe(true);

    const localeHost = persistValidEvidence({
      url: "https://uk.pinterest.com/pin/1234567890/",
      sourceUrl: "https://uk.pinterest.com/pin/1234567890/?utm_source=share"
    });
    expect(localeHost.authority).toBe("design_evidence");
    expect(localeHost.firstPartyProvenance.canonicalReferenceUrl).toBe(referenceUrl);
    expect(localeHost.firstPartyProvenance.canonicalSourceUrl).toBe(referenceUrl);
    expect(localeHost.firstPartyProvenance.sourceUrlMatchesReference).toBe(true);
  });

  it("requires image evidence to use main paths and video posters to use poster paths", () => {
    const imageWithPosterPath = persistValidEvidence(
      { kind: "image" },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "video_poster", "jpg")
    );
    expect(imageWithPosterPath.authority).toBe("diagnostic");
    expect(imageWithPosterPath.rejectionReasons).toContain("missing_artifact_path");

    const videoPosterWithMainPath = persistValidEvidence(
      { kind: "video_poster" },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg")
    );
    expect(videoPosterWithMainPath.authority).toBe("diagnostic");
    expect(videoPosterWithMainPath.rejectionReasons).toContain("missing_artifact_path");

    const dotOnlyPath = persistValidEvidence(
      { referenceId: "..." },
      "pin-media-evidence/.../main.jpg"
    );
    expect(dotOnlyPath.referenceId).toBe("reference");
    expect(dotOnlyPath.path).toBeUndefined();
    expect(dotOnlyPath.rejectionReasons).toContain("missing_artifact_path");

    const imageWithOtherReferencePath = persistValidEvidence(
      { kind: "image", referenceId: "pin A" },
      buildPinterestPinMediaEvidenceArtifactPath("pin B", "image", "jpg")
    );
    expect(imageWithOtherReferencePath.authority).toBe("diagnostic");
    expect(imageWithOtherReferencePath.path).toBeUndefined();
    expect(imageWithOtherReferencePath.rejectionReasons).toContain("missing_artifact_path");

    const posterWithOtherReferencePath = persistValidEvidence(
      { kind: "video_poster", referenceId: "pin A" },
      buildPinterestPinMediaEvidenceArtifactPath("pin B", "video_poster", "jpg")
    );
    expect(posterWithOtherReferencePath.authority).toBe("diagnostic");
    expect(posterWithOtherReferencePath.path).toBeUndefined();
    expect(posterWithOtherReferencePath.rejectionReasons).toContain("missing_artifact_path");

    const videoPoster = persistValidEvidence(
      { kind: "video_poster" },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "video_poster", "jpg")
    );
    expect(videoPoster.authority).toBe("design_evidence");
    expect(videoPoster.path).toBe("pin-media-evidence/pin-1234567890/poster.jpg");

    const videoWithMainPath = persistValidEvidence(
      { kind: "video", mediaUrl: videoMediaUrl, contentType: "video/mp4" },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "mp4"),
      makeMp4Bytes()
    );
    expect(videoWithMainPath.authority).toBe("diagnostic");
    expect(videoWithMainPath.rejectionReasons).toContain("missing_artifact_path");

    const video = persistValidEvidence(
      { kind: "video", mediaUrl: videoMediaUrl, width: 720, height: 1280, contentType: "video/mp4" },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "video", "mp4"),
      makeMp4Bytes()
    );
    expect(video.authority).toBe("design_evidence");
    expect(video.path).toBe("pin-media-evidence/pin-1234567890/video.mp4");
    expect(video.contentType).toBe("video/mp4");

    const videoWithoutByteDimensions = persistValidEvidence(
      { kind: "video", mediaUrl: videoMediaUrl, width: 720, height: 1280, contentType: "video/mp4" },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "video", "mp4"),
      makeMp4BytesWithoutDimensions()
    );
    expect(videoWithoutByteDimensions.authority).toBe("diagnostic");
    expect(videoWithoutByteDimensions.rejectionReasons).toContain("missing_dimensions");
    expect(buildInspiredesignPinterestPinMediaIndexEntry(videoWithoutByteDimensions)).toBeUndefined();

    const videoWithByteDerivedContentType = persistValidEvidence(
      { kind: "video", mediaUrl: videoMediaUrl, width: 720, height: 1280, contentType: undefined },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "video", "mp4"),
      makeMp4Bytes()
    );
    expect(videoWithByteDerivedContentType.authority).toBe("design_evidence");
    expect(videoWithByteDerivedContentType.contentType).toBe("video/mp4");

    const edgeVideo = persistValidEvidence(
      { kind: "video", mediaUrl: edgeVideoMediaUrl, width: 720, height: 1280, contentType: "video/mp4" },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "video", "mp4"),
      makeMp4Bytes()
    );
    expect(edgeVideo.authority).toBe("design_evidence");
    expect(edgeVideo.mediaUrl).toBe(edgeVideoMediaUrl);
    expect(edgeVideo.path).toBe("pin-media-evidence/pin-1234567890/video.mp4");
  });

  it("classifies artifact paths as diagnostic when they belong to another reference ID", () => {
    const persisted = persistValidEvidence();
    const classification = classifyInspiredesignPinterestPinMediaAuthority({
      ...persisted,
      path: "pin-media-evidence/other-ref/main.jpg",
      rejectionReasons: []
    });

    expect(classification.authority).toBe("diagnostic");
    expect(classification.rejectionReasons).toContain("artifact_reference_id_mismatch");
  });

  it("demotes canonical URLs when Pinterest normalization becomes unavailable", async () => {
    vi.resetModules();
    vi.doMock("../src/guidance/recipes/pinterest", async () => {
      const actual = await vi.importActual<typeof import("../src/guidance/recipes/pinterest")>(
        "../src/guidance/recipes/pinterest"
      );
      return {
        ...actual,
        normalizePinterestReferenceUrl: (): string | null => null
      };
    });
    const mockedModule = await import("../src/inspiredesign/pinterest-pin-media-evidence");
    const mockedBytes = makeJpegBytes(1200, 1600, mockedModule.MIN_PIN_MEDIA_EVIDENCE_BYTES + 1);
    const mockedEvidence = mockedModule.persistInspiredesignPinterestPinMediaEvidence(makeRuntime(), {
      artifactPath: mockedModule.buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"),
      sha256: mockedModule.hashPinterestPinMediaEvidenceBuffer(mockedBytes),
      bytes: mockedBytes.length,
      buffer: mockedBytes
    });

    expect(mockedEvidence.firstPartyProvenance.referenceUrlCanonical).toBe(false);
    expect(mockedEvidence.firstPartyProvenance.canonicalReferenceUrl).toBeUndefined();
    expect(mockedEvidence.firstPartyProvenance.canonicalSourceUrl).toBeUndefined();
    expect(mockedEvidence.authority).toBe("diagnostic");
    expect(mockedEvidence.rejectionReasons).toEqual(expect.arrayContaining([
      "invalid_reference_url",
      "source_url_mismatch"
    ]));
    vi.doUnmock("../src/guidance/recipes/pinterest");
    vi.resetModules();
  });

  it("rejects canonical authority when normalization returns a relative pin path", async () => {
    vi.resetModules();
    vi.doMock("../src/guidance/recipes/pinterest", async () => {
      const actual = await vi.importActual<typeof import("../src/guidance/recipes/pinterest")>(
        "../src/guidance/recipes/pinterest"
      );
      return {
        ...actual,
        normalizePinterestReferenceUrl: (): string | null => "/pin/1234567890/"
      };
    });
    const mockedModule = await import("../src/inspiredesign/pinterest-pin-media-evidence");
    const mockedBytes = makeJpegBytes(1200, 1600, mockedModule.MIN_PIN_MEDIA_EVIDENCE_BYTES + 1);
    const mockedEvidence = mockedModule.persistInspiredesignPinterestPinMediaEvidence(makeRuntime(), {
      artifactPath: mockedModule.buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"),
      sha256: mockedModule.hashPinterestPinMediaEvidenceBuffer(mockedBytes),
      bytes: mockedBytes.length,
      buffer: mockedBytes
    });

    expect(mockedEvidence.firstPartyProvenance.canonicalReferenceUrl).toBeUndefined();
    expect(mockedEvidence.firstPartyProvenance.canonicalSourceUrl).toBeUndefined();
    expect(mockedEvidence.firstPartyProvenance.sourceUrlMatchesReference).toBe(false);
    expect(mockedEvidence.authority).toBe("diagnostic");
    expect(mockedEvidence.rejectionReasons).toEqual(expect.arrayContaining([
      "invalid_reference_url",
      "source_url_mismatch"
    ]));
    vi.doUnmock("../src/guidance/recipes/pinterest");
    vi.resetModules();
  });

  it("demotes canonical authority when normalized Pinterest URLs lose their pin ID", async () => {
    vi.resetModules();
    vi.doMock("../src/guidance/recipes/pinterest", async () => {
      const actual = await vi.importActual<typeof import("../src/guidance/recipes/pinterest")>(
        "../src/guidance/recipes/pinterest"
      );
      return {
        ...actual,
        normalizePinterestReferenceUrl: (): string => "https://www.pinterest.com/ideas/editorial/"
      };
    });
    vi.doMock("../src/inspiredesign/pinterest-media-classification", async () => {
      const actual = await vi.importActual<typeof import("../src/inspiredesign/pinterest-media-classification")>(
        "../src/inspiredesign/pinterest-media-classification"
      );
      return {
        ...actual,
        isCanonicalPinterestPinUrl: (): boolean => true
      };
    });
    const mockedModule = await import("../src/inspiredesign/pinterest-pin-media-evidence");
    const mockedBytes = makeJpegBytes(1200, 1600, mockedModule.MIN_PIN_MEDIA_EVIDENCE_BYTES + 1);
    const mockedEvidence = mockedModule.persistInspiredesignPinterestPinMediaEvidence(makeRuntime(), {
      artifactPath: mockedModule.buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"),
      sha256: mockedModule.hashPinterestPinMediaEvidenceBuffer(mockedBytes),
      bytes: mockedBytes.length,
      buffer: mockedBytes
    });

    expect(mockedEvidence.firstPartyProvenance.referenceUrlCanonical).toBe(false);
    expect(mockedEvidence.firstPartyProvenance.canonicalReferenceUrl).toBeUndefined();
    expect(mockedEvidence.firstPartyProvenance.canonicalSourceUrl).toBeUndefined();
    expect(mockedEvidence.authority).toBe("diagnostic");
    expect(mockedEvidence.rejectionReasons).toEqual(expect.arrayContaining([
      "invalid_reference_url",
      "source_url_mismatch"
    ]));
    vi.doUnmock("../src/guidance/recipes/pinterest");
    vi.doUnmock("../src/inspiredesign/pinterest-media-classification");
    vi.resetModules();
  });



  it("requires trusted byte inspection before granting new captured authority", () => {
    const noBuffer = persistInspiredesignPinterestPinMediaEvidence(makeRuntime(), {
      artifactPath: buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"),
      sha256: validSha256,
      bytes: validBytes.length
    });

    expect(noBuffer.authority).toBe("diagnostic");
    expect(noBuffer.rejectionReasons).toContain("missing_trusted_byte_inspection");

    const alreadyFinalized = persistInspiredesignPinterestPinMediaEvidence(persistValidEvidence());
    expect(alreadyFinalized.authority).toBe("design_evidence");
  });

  it("rejects invalid bytes and byte metadata mismatches", () => {
    const invalidBytes = Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES + 1, "not-an-image");
    const invalidByteEvidence = persistValidEvidence({}, buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"), invalidBytes);
    expect(invalidByteEvidence.authority).toBe("diagnostic");
    expect(invalidByteEvidence.rejectionReasons).toContain("unsupported_byte_signature");

    const pngBytes = makePngBytes(1200, 1600);
    const mismatchedContentType = persistValidEvidence({ contentType: "image/jpeg" }, "pin-media-evidence/pin-1234567890/main.png", pngBytes);
    expect(mismatchedContentType.authority).toBe("diagnostic");
    expect(mismatchedContentType.contentType).toBe("image/png");
    expect(mismatchedContentType.rejectionReasons).toContain("content_type_mismatch");

    const mismatchedExtension = persistValidEvidence({ contentType: "image/png" }, buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpg"), pngBytes);
    expect(mismatchedExtension.authority).toBe("diagnostic");
    expect(mismatchedExtension.rejectionReasons).toContain("artifact_extension_mismatch");

    const mismatchedDimensions = persistValidEvidence({ width: 1199, height: 1600 });
    expect(mismatchedDimensions.authority).toBe("diagnostic");
    expect(mismatchedDimensions.rejectionReasons).toContain("dimension_mismatch");

    const mismatchedHeight = persistValidEvidence({ width: 1200, height: 1599 });
    expect(mismatchedHeight.authority).toBe("diagnostic");
    expect(mismatchedHeight.rejectionReasons).toContain("dimension_mismatch");

    const jpegExtension = persistValidEvidence(
      {},
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "jpeg")
    );
    expect(jpegExtension.authority).toBe("design_evidence");

    const imageWithVideoBytes = persistValidEvidence(
      { contentType: "video/mp4", mediaUrl: videoMediaUrl },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "image", "mp4"),
      makeMp4Bytes()
    );
    expect(imageWithVideoBytes.authority).toBe("diagnostic");
    expect(imageWithVideoBytes.rejectionReasons).toContain("kind_content_type_mismatch");

    const videoWithImageBytes = persistValidEvidence(
      { kind: "video", mediaUrl: videoMediaUrl, contentType: "video/mp4" },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "video", "jpg"),
      validBytes
    );
    expect(videoWithImageBytes.authority).toBe("diagnostic");
    expect(videoWithImageBytes.contentType).toBe("image/jpeg");
    expect(videoWithImageBytes.rejectionReasons).toEqual(expect.arrayContaining([
      "content_type_mismatch",
      "kind_content_type_mismatch"
    ]));

    const videoWithImageExtension = persistValidEvidence(
      { kind: "video", mediaUrl: videoMediaUrl, contentType: "video/mp4" },
      buildPinterestPinMediaEvidenceArtifactPath("pin 1234567890", "video", "jpg"),
      makeMp4Bytes()
    );
    expect(videoWithImageExtension.authority).toBe("diagnostic");
    expect(videoWithImageExtension.rejectionReasons).toContain("artifact_extension_mismatch");
  });

  it("generates index entries only for design evidence", () => {
    const persisted = persistValidEvidence();
    expect(buildInspiredesignPinterestPinMediaIndexEntry(persisted)).toEqual({
      referenceId: "pin-1234567890",
      url: referenceUrl,
      sourceUrl: `${referenceUrl}?tracking=1`,
      mediaUrl,
      pinterestPageQuality: "pin_media",
      path: "pin-media-evidence/pin-1234567890/main.jpg",
      sha256: validSha256,
      bytes: validBytes.length,
      width: 1200,
      height: 1600,
      contentType: "image/jpeg",
      kind: "image",
      authority: "design_evidence",
      capturedAt: "2026-05-27T12:00:00.000Z",
      candidateSelector: "[data-test-id='closeup-image-main-MainPinImage'] img",
      candidateRole: "img",
      candidateAlt: "Editorial outfit reference",
      warnings: [],
      firstPartyProvenance: {
        canonicalReferenceUrl: referenceUrl,
        canonicalSourceUrl: referenceUrl,
        referenceUrlCanonical: true,
        sourceUrlMatchesReference: true,
        mediaUrlFirstParty: true
      }
    });

    const diagnostic = persistValidEvidence({ pinterestPageQuality: "search_shell" });
    expect(diagnostic.authority).toBe("diagnostic");
    expect(buildInspiredesignPinterestPinMediaIndexEntry(diagnostic)).toBeUndefined();
  });
});
