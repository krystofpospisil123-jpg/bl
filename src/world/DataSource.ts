// Where world data comes from: separate files next to the page (normal web hosting),
// or a gzip pack embedded in the page itself (single-file build, used where the page
// cannot load other files, e.g. inside some app viewers).
export type DataGet = (path: string) => Promise<Response>;

const PACK_ID = 'world-pack';

export async function openDataSource(baseUrl: string): Promise<DataGet> {
  const el = typeof document !== 'undefined' ? document.getElementById(PACK_ID) : null;
  if (!el) return (path) => fetch(baseUrl + path);
  const files = await unpack(el.textContent ?? '');
  el.textContent = ''; // free the large string
  return async (path) => {
    const bytes = files.get(path);
    if (!bytes) return new Response(null, { status: 404 });
    const type = path.endsWith('.png') ? 'image/png' : path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.glb') ? 'model/gltf-binary' : 'application/json';
    return new Response(new Blob([bytes as BlobPart], { type }));
  };
}

/** Pack layout (before gzip): uint32 index length, index JSON {path: [offset, length]}, bytes. */
async function unpack(base64: string): Promise<Map<string, Uint8Array>> {
  const bin = atob(base64.replace(/\s+/g, ''));
  const gz = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const indexLen = new DataView(raw.buffer).getUint32(0, true);
  const index: Record<string, [number, number]> = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + indexLen)));
  const base = 4 + indexLen;
  const files = new Map<string, Uint8Array>();
  for (const [path, [off, len]] of Object.entries(index)) files.set(path, raw.subarray(base + off, base + off + len));
  return files;
}
