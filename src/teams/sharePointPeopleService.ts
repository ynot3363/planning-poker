import type { UserReference } from '../domain/planningPokerDomain';
import type { ISharePointTransport } from '../storage/storageTypes';

/** Defines people resolution operations used by team host and member pickers. */
export interface IPlanningPokerPeopleService {
  /**
   * Finds site-resolvable people for a picker query.
   *
   * @param query - User-entered display name, email, or login fragment.
   * @returns Up to ten resolved stable user references.
   */
  search(query: string): Promise<readonly UserReference[]>;
  /**
   * Resolves one login into a site user and stable Entra identity.
   *
   * @param loginName - SharePoint login name or email.
   * @returns The ensured site user reference.
   */
  resolve(loginName: string): Promise<UserReference>;
}

/** Represents a safe people-directory failure for team UI. */
export class PeopleDirectoryError extends Error {
  /** Creates a non-sensitive people resolution error. */
  public constructor() {
    super('People could not be resolved from this SharePoint site.');
    this.name = 'PeopleDirectoryError';
    Object.setPrototypeOf(this, PeopleDirectoryError.prototype);
  }
}

interface IPickerEntity {
  readonly Key?: unknown;
  readonly DisplayText?: unknown;
  readonly EntityData?: {
    readonly Email?: unknown;
    readonly ObjectId?: unknown;
    readonly SPUserID?: unknown;
  };
}

interface IEnsuredUser {
  readonly Id?: unknown;
  readonly Title?: unknown;
  readonly LoginName?: unknown;
  readonly Email?: unknown;
  readonly UserId?: { readonly NameId?: unknown };
}

/** Uses SharePoint's native people picker and ensure-user endpoints without extra Graph scopes. */
export class SharePointPeopleService implements IPlanningPokerPeopleService {
  /**
   * Creates a site-scoped people service.
   *
   * @param transport - Authenticated SharePoint transport.
   */
  public constructor(private readonly transport: ISharePointTransport) {}

  /** @inheritdoc */
  public async search(query: string): Promise<readonly UserReference[]> {
    const value = query.trim();
    if (value.length < 2) {
      return [];
    }
    try {
      const response = await this.transport.post<unknown>(
        '_api/SP.UI.ApplicationPages.ClientPeoplePickerWebServiceInterface.clientPeoplePickerSearchUser',
        {
          queryParams: {
            AllowEmailAddresses: true,
            AllowMultipleEntities: true,
            AllUrlZones: false,
            MaximumEntitySuggestions: 10,
            PrincipalSource: 15,
            PrincipalType: 1,
            QueryString: value
          }
        }
      );
      const entities = this.parsePickerEntities(response);
      const users = await Promise.all(
        entities.map((entity) =>
          this.ensureUser(
            this.readString(entity.Key),
            this.readString(entity.EntityData?.ObjectId),
            this.readString(entity.DisplayText)
          )
        )
      );
      const byObjectId = new Map<string, UserReference>();
      for (const user of users) {
        byObjectId.set(user.objectId.toLocaleLowerCase(), user);
      }
      return Array.from(byObjectId.values());
    } catch {
      throw new PeopleDirectoryError();
    }
  }

  /** @inheritdoc */
  public async resolve(loginName: string): Promise<UserReference> {
    try {
      const matches = await this.search(loginName.trim());
      if (matches.length > 0) {
        return matches[0];
      }
      return await this.ensureUser(loginName.trim());
    } catch {
      throw new PeopleDirectoryError();
    }
  }

  /**
   * Ensures one picker entity in the current SharePoint site.
   *
   * @param loginName - Claims login returned by the people picker.
   * @param pickerObjectId - Optional Entra object ID returned by the picker.
   * @param pickerDisplayName - Optional display name returned by the picker.
   * @returns The stable site user reference.
   */
  private async ensureUser(
    loginName: string | undefined,
    pickerObjectId?: string,
    pickerDisplayName?: string
  ): Promise<UserReference> {
    if (loginName === undefined || loginName.length === 0) {
      throw new PeopleDirectoryError();
    }
    const response = await this.transport.post<unknown>('_api/web/ensureuser', {
      logonName: loginName
    });
    const user = this.unwrapEnsuredUser(response);
    const resolvedLogin = this.readString(user.LoginName) ?? loginName;
    const objectId = pickerObjectId ?? this.readString(user.UserId?.NameId);
    const displayName = this.readString(user.Title) ?? pickerDisplayName;
    const sharePointUserId = this.readNumber(user.Id);
    if (objectId === undefined || displayName === undefined || sharePointUserId === undefined) {
      throw new PeopleDirectoryError();
    }
    return {
      objectId,
      displayName,
      loginName: resolvedLogin,
      sharePointUserId
    };
  }

  /**
   * Parses modern and verbose people-picker response envelopes.
   *
   * @param value - Untrusted SharePoint response.
   * @returns Parsed picker entities.
   */
  private parsePickerEntities(value: unknown): readonly IPickerEntity[] {
    if (typeof value !== 'object' || value === null) {
      return [];
    }
    const envelope = value as {
      value?: unknown;
      d?: { ClientPeoplePickerSearchUser?: unknown };
    };
    const serialized = envelope.value ?? envelope.d?.ClientPeoplePickerSearchUser;
    if (typeof serialized !== 'string') {
      return [];
    }
    const parsed: unknown = JSON.parse(serialized) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entity): entity is IPickerEntity => typeof entity === 'object' && entity !== null
        )
      : [];
  }

  /**
   * Unwraps modern and verbose ensure-user response envelopes.
   *
   * @param value - Untrusted SharePoint response.
   * @returns The candidate ensured user object.
   */
  private unwrapEnsuredUser(value: unknown): IEnsuredUser {
    if (typeof value !== 'object' || value === null) {
      return {};
    }
    const envelope = value as IEnsuredUser & { d?: IEnsuredUser };
    return envelope.d ?? envelope;
  }

  /**
   * @param value - The untrusted candidate value.
   * @returns A non-empty string from an untrusted value when available.
   */
  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  /**
   * @param value - The untrusted candidate value.
   * @returns A positive integer from an untrusted value when available.
   */
  private readNumber(value: unknown): number | undefined {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(number) && number > 0 ? number : undefined;
  }
}
