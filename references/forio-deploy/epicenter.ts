import { Fault, Router } from 'epicenter-libs';
import config from './config.json';

export const normalizeFetchResponse = async (
  response: Response,
  reader?: (response: Response) => Promise<any>
) => {
  const contentType = response.headers.get('content-type') || '';
  const matchJSON = contentType.toLowerCase().includes('application/json');

  let payload;
  try {
    payload = reader
      ? await reader(response)
      : matchJSON
        ? await response.json()
        : await response.text();
  } catch (parseError) {
    throw new Fault(
      {
        status: response.status,
        message: `Failed to parse response from ${response.url} with response type ${contentType}.`,
        cause: parseError,
      },
      response
    );
  }

  if (response.ok) return payload;

  const message =
    typeof payload === 'string'
      ? payload
      : payload?.message || 'An unknown error occurred';

  throw new Fault(
    {
      status: response.status,
      message,
      information:
        typeof payload === 'object' && 'information' in payload
          ? payload.information
          : undefined,
    },
    response
  );
};

const router = () =>
  new Router()
    .withServer(config.SERVER)
    .withAccountShortName(config.ACCOUNT_SHORT_NAME)
    .withProjectShortName(config.PROJECT_SHORT_NAME);

export const login = () =>
  router()
    .post('/authentication', {
      inert: true,
      body: {
        handle: config.ADMIN_HANDLE,
        password: config.ADMIN_PASSWORD,
        objectType: 'admin',
      },
    })
    .then(({ body }) => body)
    .then(({ token }) => token as string);

export const getFiles = (token: string, path: string) =>
  router()
    .withAuthorization(`Bearer ${token}`)
    .get(`file/${path}`)
    .then(
      ({ body }) =>
        body as Array<{ name: string; objectType: 'directory' | 'file' }>
    );

export const downloadFile = (token: string, path: string) => {
  const url = router().getURL(`file/download/${path}`);
  return fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  }).then((res) => normalizeFetchResponse(res, (res) => res.blob()));
};

export const emptyDirectory = async (path: string, token: string) => {
  const files = await getFiles(token, path).then((files) =>
    files.filter((file) =>
      file.objectType === 'file'
        ? !(file.name.startsWith('run') && file.name.endsWith('.log.txt'))
        : true
    )
  );

  for (const file of files) {
    await router()
      .withAuthorization(`Bearer ${token}`)
      .delete(`file/${path}/${file.name}`);
  }

  return;
};

export const postZip = (path: string, token: string) => (file: File) => {
  const payload = new FormData();
  payload.append('file', file);

  const url = router().getURL(`file/${path}`);
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: payload,
  }).then(normalizeFetchResponse);
};

export const explodeZip = (path: string, token: string) => {
  const url = router().getURL(`file/explode/${path}`);
  return fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  }).then(normalizeFetchResponse);
};

export const getRunKey = (token: string) =>
  router()
    .withAuthorization(`Bearer ${token}`)
    .get('/run/proxy/key')
    .then(({ body }) => body);

export const stopProxy = (token: string) => (runKey: string) =>
  router()
    .withAuthorization(`Bearer ${token}`)
    .withSearchParams([['runKey', runKey]])
    .delete('run')
    .then(({ body }) => body)
    .catch((error) => {
      if (error instanceof Fault) {
        if (error.status === 404) return;
        throw error;
      }
      throw error;
    });
