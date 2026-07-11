import type { ISharePointTransport } from '../storage/storageTypes';
import { PeopleDirectoryError, SharePointPeopleService } from './sharePointPeopleService';

function createTransport(
  post: (path: string, body?: unknown) => Promise<unknown>
): ISharePointTransport {
  return {
    get: jest.fn(async () => undefined) as ISharePointTransport['get'],
    post: jest.fn(post) as ISharePointTransport['post'],
    patch: jest.fn(async () => undefined) as ISharePointTransport['patch']
  };
}

describe('SharePointPeopleService', () => {
  it('searches the native picker and ensures unique stable site users', async () => {
    const transport = createTransport(async (path) => {
      if (path.includes('clientPeoplePickerSearchUser')) {
        return {
          value: JSON.stringify([
            {
              Key: 'i:0#.f|membership|ada@example.com',
              DisplayText: 'Ada Lovelace',
              EntityData: { ObjectId: 'object-1' }
            },
            {
              Key: 'i:0#.f|membership|ada@example.com',
              DisplayText: 'Ada Lovelace',
              EntityData: { ObjectId: 'object-1' }
            }
          ])
        };
      }
      return {
        Id: 17,
        Title: 'Ada Lovelace',
        LoginName: 'i:0#.f|membership|ada@example.com'
      };
    });
    const service = new SharePointPeopleService(transport);

    await expect(service.search('ada')).resolves.toEqual([
      {
        objectId: 'object-1',
        displayName: 'Ada Lovelace',
        loginName: 'i:0#.f|membership|ada@example.com',
        sharePointUserId: 17
      }
    ]);
    expect(transport.post).toHaveBeenCalledWith(
      expect.stringContaining('clientPeoplePickerSearchUser'),
      expect.objectContaining({ queryParams: expect.objectContaining({ QueryString: 'ada' }) })
    );
  });

  it('resolves the current user from verbose ensure-user data', async () => {
    const service = new SharePointPeopleService(
      createTransport(async () => ({
        d: {
          Id: '21',
          Title: 'Grace Hopper',
          LoginName: 'grace@example.com',
          UserId: { NameId: 'object-2' }
        }
      }))
    );

    await expect(service.resolve('grace@example.com')).resolves.toMatchObject({
      objectId: 'object-2',
      displayName: 'Grace Hopper',
      sharePointUserId: 21
    });
  });

  it('does not call SharePoint for an undersized query', async () => {
    const transport = createTransport(async () => undefined);
    const service = new SharePointPeopleService(transport);

    await expect(service.search('a')).resolves.toEqual([]);
    expect(transport.post).not.toHaveBeenCalled();
  });

  it('maps malformed or failed responses to a safe directory error', async () => {
    const service = new SharePointPeopleService(
      createTransport(async () => {
        throw new Error('sensitive transport details');
      })
    );

    await expect(service.resolve('ada@example.com')).rejects.toBeInstanceOf(PeopleDirectoryError);
  });
});
