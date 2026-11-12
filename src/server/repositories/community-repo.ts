import type { Apartment, Building, Community } from "@/shared/types";
import { keys, strip } from "../db/keys";
import { cond, type Table, type TxOp } from "../db/table";

export class CommunityRepo {
  constructor(private readonly table: Table) {}

  async get(communityId: string): Promise<Community | null> {
    const item = await this.table.get(keys.communityRegistry(communityId));
    return item ? strip<Community>(item) : null;
  }

  async getByJoinCode(joinCode: string): Promise<Community | null> {
    const res = await this.table.query({ index: "GSI1", pk: keys.communityJoinIndex(joinCode), limit: 1 });
    return res.items[0] ? strip<Community>(res.items[0]) : null;
  }

  /** All tenants — used only by scheduled jobs, never by request handlers. */
  async listIds(): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.table.query({ pk: "COMMUNITIES", sk: { beginsWith: "C#" }, limit: 100, cursor });
      ids.push(...res.items.map((i) => i.communityId as string));
      cursor = res.cursor ?? undefined;
    } while (cursor);
    return ids;
  }

  putOp(community: Community): TxOp {
    return {
      type: "put",
      item: {
        ...keys.communityRegistry(community.communityId),
        GSI1PK: keys.communityJoinIndex(community.joinCode),
        GSI1SK: `C#${community.communityId}`,
        entity: "Community",
        ...community,
      },
      condition: cond.notExists(),
    };
  }

  async update(communityId: string, patch: Partial<Omit<Community, "communityId" | "joinCode" | "createdAt">>) {
    const item = await this.table.update(keys.communityRegistry(communityId), { set: patch }, cond.exists());
    return strip<Community>(item);
  }
}

export class PropertyRepo {
  constructor(private readonly table: Table) {}

  async listBuildings(cid: string): Promise<Building[]> {
    const res = await this.table.query({ pk: `C#${cid}`, sk: { beginsWith: "BLDG#" }, limit: 500 });
    return res.items.map((i) => strip<Building>(i)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getBuilding(cid: string, buildingId: string): Promise<Building | null> {
    const item = await this.table.get(keys.building(cid, buildingId));
    return item ? strip<Building>(item) : null;
  }

  async putBuilding(b: Building, isNew: boolean) {
    await this.table.put({ ...keys.building(b.communityId, b.buildingId), entity: "Building", ...b }, isNew ? cond.notExists() : cond.exists());
  }

  async deleteBuilding(cid: string, buildingId: string) {
    await this.table.delete(keys.building(cid, buildingId), cond.exists());
  }

  async listApartments(cid: string, buildingId?: string): Promise<Apartment[]> {
    const res = buildingId
      ? await this.table.query({ index: "GSI1", pk: keys.apartmentsByBuilding(cid, buildingId), limit: 2000 })
      : await this.table.query({ pk: `C#${cid}`, sk: { beginsWith: "APT#" }, limit: 2000 });
    return res.items
      .map((i) => strip<Apartment>(i))
      .sort((a, b) => a.buildingName.localeCompare(b.buildingName) || a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
  }

  async countApartments(cid: string, buildingId: string) {
    return this.table.count({ index: "GSI1", pk: keys.apartmentsByBuilding(cid, buildingId) });
  }

  async getApartment(cid: string, apartmentId: string): Promise<Apartment | null> {
    const item = await this.table.get(keys.apartment(cid, apartmentId));
    return item ? strip<Apartment>(item) : null;
  }

  /** Unit numbers are unique per building, enforced by a claim item in the same transaction. */
  async createApartment(a: Apartment) {
    await this.table.transact([
      {
        type: "put",
        item: {
          ...keys.apartment(a.communityId, a.apartmentId),
          GSI1PK: keys.apartmentsByBuilding(a.communityId, a.buildingId),
          GSI1SK: `APT#${a.unitNumber}`,
          entity: "Apartment",
          ...a,
        },
        condition: cond.notExists(),
      },
      {
        type: "put",
        item: { PK: `C#${a.communityId}`, SK: `UNIT#${a.buildingId}#${a.unitNumber}`, apartmentId: a.apartmentId },
        condition: cond.notExists(),
      },
    ]);
  }

  async deleteApartment(a: Apartment) {
    await this.table.transact([
      { type: "delete", key: keys.apartment(a.communityId, a.apartmentId), condition: cond.exists() },
      { type: "delete", key: { PK: `C#${a.communityId}`, SK: `UNIT#${a.buildingId}#${a.unitNumber}` } },
    ]);
  }

  async residentIds(cid: string, apartmentId: string): Promise<string[]> {
    const res = await this.table.query({ pk: `C#${cid}`, sk: { beginsWith: `APTRES#${apartmentId}#` }, limit: 50 });
    return res.items.map((i) => i.userId as string);
  }

  linkResidentOp(cid: string, apartmentId: string, userId: string): TxOp {
    return { type: "put", item: { ...keys.apartmentResident(cid, apartmentId, userId), userId, apartmentId } };
  }

  unlinkResidentOp(cid: string, apartmentId: string, userId: string): TxOp {
    return { type: "delete", key: keys.apartmentResident(cid, apartmentId, userId) };
  }
}
