import Redis from 'ioredis';

let redis: Redis | null = null;
let redisAvailable = false;

export function parseRedisUrl(raw: string): string | null {
  const decoded = decodeURIComponent(raw).trim();

  // Extract the redis:// or rediss:// URL from CLI-style strings like:
  //   "redis-cli --tls -u redis://default:pass@host:port"
  const match = decoded.match(/(rediss?:\/\/\S+)/);
  let url = match ? match[1] : null;

  if (!url) {
    if (decoded.startsWith('redis://') || decoded.startsWith('rediss://')) {
      url = decoded;
    } else {
      return null;
    }
  }

  // If the original string had --tls flag, upgrade redis:// → rediss://
  if (decoded.includes('--tls') && url.startsWith('redis://')) {
    url = url.replace('redis://', 'rediss://');
  }

  return url;
}

export function buildRedisOptions(url: string): object {
  const isTls = url.startsWith('rediss://');
  return {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    lazyConnect: true,
    enableOfflineQueue: false,
    ...(isTls ? { tls: {} } : {}),
  };
}

async function initRedis() {
  if (!process.env.REDIS_URL) {
    console.warn('[Redis] REDIS_URL not set — rate limiting will use in-memory fallback');
    return;
  }

  const resolvedUrl = parseRedisUrl(process.env.REDIS_URL);
  if (!resolvedUrl) {
    console.warn('[Redis] Could not parse a valid Redis URL from REDIS_URL — using in-memory fallback');
    return;
  }

  try {
    const client = new Redis(resolvedUrl, buildRedisOptions(resolvedUrl));

    client.on('connect', () => {
      redisAvailable = true;
      console.log('[Redis] Connected successfully');
    });

    client.on('error', (err) => {
      if (redisAvailable) {
        console.warn('[Redis] Connection error — falling back to in-memory:', err.message);
      }
      redisAvailable = false;
    });

    client.on('close', () => {
      redisAvailable = false;
    });

    await client.connect();
    redis = client;
    console.log('[Redis] Rate limiting initialized with Redis store');
  } catch (err: any) {
    console.warn('[Redis] Failed to connect — rate limiting will use in-memory fallback:', err.message);
    redis = null;
    redisAvailable = false;
  }
}

initRedis().catch(() => {});

export { redis, redisAvailable };
