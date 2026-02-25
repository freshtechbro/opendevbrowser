import Image from "next/image";

type VisualWallProps = {
  images: Array<{ src: string; alt: string }>;
};

export function VisualWall({ images }: VisualWallProps) {
  return (
    <div className="grid cols-3">
      {images.map((image) => (
        <article key={image.src} className="card elevated reveal">
          <Image src={image.src} alt={image.alt} width={1024} height={572} style={{ borderRadius: 12, width: "100%", height: "auto" }} />
        </article>
      ))}
    </div>
  );
}
