// Where large files (videos) are kept. Photos are small enough for the database; a video can be up
// to 16 MB, so it goes to a file store: Cloudflare KV in production (set from cloudflare/worker.js),
// and memory when running locally in Node or in tests.
const memory = new Map();

let store = {
  name: 'memory',
  async put(key, bytes, mime) {
    memory.set(key, { bytes, mime });
  },
  async get(key) {
    return memory.get(key) || null;
  },
};

/** The file store: { name, put(key, bytes, mime), get(key) -> { bytes, mime } | null }. */
export const blobs = () => store;

export function setBlobStore(s) {
  store = s;
}
