import Image from "next/image";

export function HeroVisual() {
  return (
    <Image
      src="/brand/hero-image.png"
      alt="OpenDevBrowser isometric automation hero"
      width={1200}
      height={675}
      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "16px" }}
      priority
    />
  );
}
