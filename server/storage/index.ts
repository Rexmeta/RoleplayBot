export { db, pool, checkDatabaseConnection } from "./db";

import { ConversationsMixin, MemConversationsStorage } from "./conversations";
import { SessionsMixin, MemSessionsStorage } from "./sessions";
import { UsersMixin, MemUsersStorage } from "./users";
import { CategoriesMixin, MemCategoriesStorage } from "./categories";
import { SettingsMixin, MemSettingsStorage } from "./settings";
import { AnalyticsMixin, MemAnalyticsStorage } from "./analytics";
import { TranslationsMixin, MemTranslationsStorage } from "./translations";
import { ScenariosMixin, MemScenariosStorage } from "./scenarios";
import { PersonasMixin, MemPersonasStorage } from "./personas";
import { OrganizationsMixin, MemOrganizationsStorage } from "./organizations";

export type { IConversationsStorage } from "./conversations";
export type { ISessionsStorage } from "./sessions";
export type { IUsersStorage } from "./users";
export type { ICategoriesStorage } from "./categories";
export type { ISettingsStorage } from "./settings";
export type { IAnalyticsStorage } from "./analytics";
export type { ITranslationsStorage } from "./translations";
export type { IScenariosStorage } from "./scenarios";
export type { IPersonasStorage } from "./personas";
export type { IOrganizationsStorage } from "./organizations";

import type { IConversationsStorage } from "./conversations";
import type { ISessionsStorage } from "./sessions";
import type { IUsersStorage } from "./users";
import type { ICategoriesStorage } from "./categories";
import type { ISettingsStorage } from "./settings";
import type { IAnalyticsStorage } from "./analytics";
import type { ITranslationsStorage } from "./translations";
import type { IScenariosStorage } from "./scenarios";
import type { IPersonasStorage } from "./personas";
import type { IOrganizationsStorage } from "./organizations";

export interface IStorage extends
  IConversationsStorage,
  ISessionsStorage,
  IUsersStorage,
  ICategoriesStorage,
  ISettingsStorage,
  IAnalyticsStorage,
  ITranslationsStorage,
  IScenariosStorage,
  IPersonasStorage,
  IOrganizationsStorage {}

const CombinedBase = OrganizationsMixin(
  PersonasMixin(
    ScenariosMixin(
      TranslationsMixin(
        AnalyticsMixin(
          SettingsMixin(
            CategoriesMixin(
              SessionsMixin(
                UsersMixin(
                  ConversationsMixin(class {})
                )
              )
            )
          )
        )
      )
    )
  )
);

export class PostgreSQLStorage extends CombinedBase implements IStorage {}

// Declaration merging: MemStorage satisfies IStorage via the interface,
// while the class itself uses a Proxy to auto-delegate to domain sub-storages.
// Adding a new storage method now only requires changes in the domain file —
// no manual delegation wiring needed here.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface MemStorage extends IStorage {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class MemStorage {
  constructor() {
    const delegates: object[] = [
      new MemConversationsStorage(),
      new MemSessionsStorage(),
      new MemUsersStorage(),
      new MemCategoriesStorage(),
      new MemSettingsStorage(),
      new MemAnalyticsStorage(),
      new MemTranslationsStorage(),
      new MemScenariosStorage(),
      new MemPersonasStorage(),
      new MemOrganizationsStorage(),
    ];

    return new Proxy(this as unknown as IStorage, {
      get(target, prop: string | symbol, receiver) {
        // Prefer own/prototype members on the target first so built-ins
        // (constructor, toString, Symbol.*, etc.) are never shadowed.
        const own = Reflect.get(target, prop, receiver);
        if (own !== undefined) return own;

        // Then search delegates in declaration order; first match wins.
        if (typeof prop === "symbol") return undefined;
        for (const delegate of delegates) {
          const val = (delegate as Record<string, unknown>)[prop];
          if (typeof val === "function") return val.bind(delegate);
        }
        throw new Error(
          `MemStorage: no delegate implements method '${String(prop)}'`
        );
      },
    });
  }
}

export const storage = new PostgreSQLStorage();
