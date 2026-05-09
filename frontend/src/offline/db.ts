import Dexie, { type EntityTable } from "dexie";
import type { OfflineSaleQueueItem } from "./types";

export const offlineDb = new Dexie("pos_offline") as Dexie & {
  offline_sales: EntityTable<OfflineSaleQueueItem, "client_uuid">;
};

offlineDb.version(1).stores({
  offline_sales: "client_uuid,status,updated_at",
});
