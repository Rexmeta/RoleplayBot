import { pgTable, uuid, varchar, integer, timestamp, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import type { CultureProfileInput } from "../cultureMap";

// Independent of all Persona records. Versions remain after soft deletion.
export const cultureProfiles = pgTable("culture_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: varchar("owner_id").notNull(),
  version: integer("version").notNull().default(1),
  content: jsonb("content").$type<CultureProfileInput>().notNull(),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const cultureProfileVersions = pgTable("culture_profile_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => cultureProfiles.id),
  version: integer("version").notNull(),
  content: jsonb("content").$type<CultureProfileInput>().notNull(),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => ({ versionUnique: uniqueIndex("culture_profile_version_unique").on(table.profileId, table.version) }));
