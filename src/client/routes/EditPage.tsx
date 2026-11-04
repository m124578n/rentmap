import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { api } from "@/lib/api";
import type { City } from "@shared/constants";
import { PropertyForm, type EditTarget } from "./NewPage";

/** 修改筆記:跟新增同一份表單,預填目前的值 */
export function EditPage() {
  const id = Number(useParams({ from: "/p/$id/edit" }).id);
  const q = useQuery({ queryKey: ["property", id], queryFn: () => api.getProperty(id), enabled: Number.isInteger(id) });
  if (q.isLoading) return <p className="p-4 text-neutral-500">載入中…</p>;
  if (q.error || !q.data) return <p className="p-4 text-red-600">找不到這間房源</p>;
  const { property: p, listings } = q.data;
  const l = listings[0];
  const deal = p.deal === "buy" ? "buy" : "rent";
  const edit: EditTarget = {
    id,
    deal,
    city: p.city as City,
    facts: {
      title: p.title,
      district: p.district,
      road: p.road,
      address_text: p.addressText,
      lat: p.lat,
      lng: p.lng,
      kind: p.kind,
      building_type: p.buildingType,
      floor: p.floor,
      total_floors: p.totalFloors,
      building_age: p.buildingAge,
      size_ping: p.sizePing,
      land_ping: p.landPing,
      rooms: p.rooms,
      living_rooms: p.livingRooms,
      bathrooms: p.bathrooms,
      has_elevator: p.hasElevator,
      has_parking: p.hasParking,
      pet_allowed: p.petAllowed,
      cooking_allowed: p.cookingAllowed,
      has_washer: p.hasWasher,
      has_internet: p.hasInternet,
      mgmt_fee: p.mgmtFee,
      utilities_note: p.utilitiesNote,
      note: p.note,
      source: l?.source,
      source_url: l?.sourceUrl,
      rent: deal === "rent" ? l?.rent : null,
      // 總價用「萬」輸入
      price_wan: deal === "buy" && l?.price ? l.price / 10000 : null,
      deposit_months: l?.depositMonths,
      contact_name: l?.contactName,
      contact_phone: l?.contactPhone,
      contact_line: l?.contactLine,
    },
  };
  return <PropertyForm key={id} edit={edit} />;
}
