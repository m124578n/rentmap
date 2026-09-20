import { useParams } from "@tanstack/react-router";
import { PropertyDetail } from "@/features/property/PropertyDetail";

export function DetailPage() {
  const { id } = useParams({ from: "/p/$id" });
  return (
    <div className="mx-auto max-w-3xl">
      <PropertyDetail id={Number(id)} />
    </div>
  );
}
