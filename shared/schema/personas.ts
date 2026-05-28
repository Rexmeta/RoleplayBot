import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, index, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const mbtiPersonas = pgTable("mbti_personas", {
  id: varchar("id").primaryKey(),
  mbti: varchar("mbti").notNull(),
  gender: varchar("gender"),
  personalityTraits: text("personality_traits").array(),
  communicationStyle: text("communication_style"),
  motivation: text("motivation"),
  fears: text("fears").array(),
  background: jsonb("background").$type<{
    personal_values: string[];
    hobbies: string[];
    social: {
      preference: string;
      behavior: string;
    };
  }>(),
  communicationPatterns: jsonb("communication_patterns").$type<{
    opening_style: string;
    key_phrases: string[];
    response_to_arguments: Record<string, string>;
    win_conditions: string[];
  }>(),
  voice: jsonb("voice").$type<{
    tone: string;
    pace: string;
    volume?: string;
    pitch?: string;
  }>(),
  images: jsonb("images").$type<{
    base?: string;
    style?: string;
    male?: {
      expressions?: Record<string, string>;
    };
    female?: {
      expressions?: Record<string, string>;
    };
  }>(),
  freeChatAvailable: boolean("free_chat_available").notNull().default(false),
  freeChatDescription: text("free_chat_description"),
  storeListed: boolean("store_listed").notNull().default(false),
  storePriceUsd: doublePrecision("store_price_usd"),
  storePackId: varchar("store_pack_id"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userPersonas = pgTable("user_personas", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  creatorId: varchar("creator_id", { length: 36 }).notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  greeting: text("greeting").notNull().default(""),
  avatarUrl: text("avatar_url"),
  expressions: jsonb("expressions").$type<Record<string, string>>(),
  gender: varchar("gender"),
  personality: jsonb("personality").$type<{
    traits: string[];
    communicationStyle: string;
    background: string;
    speechStyle: string;
  }>().default({ traits: [], communicationStyle: "", background: "", speechStyle: "" }),
  tags: text("tags").array().default([]),
  isPublic: boolean("is_public").notNull().default(false),
  likeCount: integer("like_count").notNull().default(0),
  chatCount: integer("chat_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const userPersonaLikes = pgTable("user_persona_likes", {
  userId: varchar("user_id", { length: 36 }).notNull(),
  personaId: varchar("persona_id", { length: 36 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const personaUserScenes = pgTable("persona_user_scenes", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  creatorId: varchar("creator_id", { length: 36 }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  setting: text("setting").notNull().default(""),
  mood: text("mood").notNull().default(""),
  openingLine: text("opening_line").notNull().default(""),
  genre: text("genre").notNull().default("일상"),
  tags: text("tags").array().default([]),
  isPublic: boolean("is_public").notNull().default(false),
  useCount: integer("use_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMbtiPersonaSchema = createInsertSchema(mbtiPersonas).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertMbtiPersona = z.infer<typeof insertMbtiPersonaSchema>;
export type MbtiPersona = typeof mbtiPersonas.$inferSelect;

export const insertUserPersonaSchema = createInsertSchema(userPersonas).omit({
  id: true,
  likeCount: true,
  chatCount: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserPersona = z.infer<typeof insertUserPersonaSchema>;
export type UserPersona = typeof userPersonas.$inferSelect;

export const insertPersonaUserSceneSchema = createInsertSchema(personaUserScenes).omit({
  id: true,
  useCount: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPersonaUserScene = z.infer<typeof insertPersonaUserSceneSchema>;
export type PersonaUserScene = typeof personaUserScenes.$inferSelect;

