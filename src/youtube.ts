interface YouTubePlayer {
  cueVideoById: (videoId: string) => void;
  destroy: () => void;
  getDuration: () => number;
  getPlaylist: () => string[];
}

interface YouTubePlayerOptions {
  height: number;
  videoId?: string;
  width: number;
  playerVars: { autoplay: number; controls: number; origin: string; playsinline: number; list?: string; listType?: "playlist" };
  events: {
    onError: () => void;
    onReady: (event: { target: YouTubePlayer }) => void;
  };
}

interface YouTubeApi {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    const script = existing ?? document.createElement("script");
    window.onYouTubeIframeAPIReady = () => {
      try { previousReady?.(); } catch { /* Keep the API available if another callback fails. */ }
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player API failed to initialize."));
    };
    script.addEventListener("error", () => reject(new Error("YouTube player API failed to load.")), { once: true });
    if (!existing) {
      script.src = "https://www.youtube.com/iframe_api";
      document.head.append(script);
    }
  }).catch(error => {
    apiPromise = null;
    throw error;
  });

  return apiPromise;
}

/** Reads duration through YouTube's player API without starting playback. */
export async function fetchYouTubeDuration(videoId: string): Promise<number | null> {
  let api: YouTubeApi;
  try {
    api = await loadYouTubeApi();
  } catch {
    return null;
  }

  return new Promise(resolve => {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:200px;height:200px;opacity:0;pointer-events:none";
    document.body.append(host);

    let player: YouTubePlayer | undefined;
    let pollId: number | undefined;
    let timeoutId: number | undefined;
    let settled = false;
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      if (pollId !== undefined) window.clearInterval(pollId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      try { player?.destroy(); } catch { /* The iframe may already have been removed. */ }
      host.remove();
      resolve(duration);
    };
    const readDuration = () => {
      const duration = player?.getDuration() ?? 0;
      if (Number.isFinite(duration) && duration > 0) finish(Math.round(duration));
    };

    timeoutId = window.setTimeout(() => finish(null), 15000);
    try {
      player = new api.Player(host, {
        height: 200,
        videoId,
        width: 200,
        playerVars: { autoplay: 0, controls: 0, origin: window.location.origin, playsinline: 1 },
        events: {
          onError: () => finish(null),
          onReady: event => {
            player = event.target;
            player.cueVideoById(videoId);
            pollId = window.setInterval(readDuration, 250);
            readDuration();
          },
        },
      });
    } catch {
      finish(null);
    }
  });
}

/** Reads every available video ID from a public playlist through the player API. */
export async function fetchYouTubePlaylistIds(playlistId: string): Promise<string[]> {
  let api: YouTubeApi;
  try {
    api = await loadYouTubeApi();
  } catch {
    return [];
  }

  return new Promise(resolve => {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:200px;height:200px;opacity:0;pointer-events:none";
    document.body.append(host);

    let player: YouTubePlayer | undefined;
    let pollId: number | undefined;
    let timeoutId: number | undefined;
    let settled = false;
    const finish = (videoIds: string[]) => {
      if (settled) return;
      settled = true;
      if (pollId !== undefined) window.clearInterval(pollId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      try { player?.destroy(); } catch { /* The iframe may already have been removed. */ }
      host.remove();
      resolve(videoIds);
    };
    const readPlaylist = () => {
      try {
        const videoIds = player?.getPlaylist().filter(Boolean) ?? [];
        if (videoIds.length) finish([...new Set(videoIds)]);
      } catch { /* Wait for the playlist data to become available. */ }
    };

    timeoutId = window.setTimeout(() => finish([]), 30000);
    try {
      player = new api.Player(host, {
        height: 200,
        width: 200,
        playerVars: { autoplay: 0, controls: 0, origin: window.location.origin, playsinline: 1, list: playlistId, listType: "playlist" },
        events: {
          onError: () => finish([]),
          onReady: event => {
            player = event.target;
            pollId = window.setInterval(readPlaylist, 250);
            readPlaylist();
          },
        },
      });
    } catch {
      finish([]);
    }
  });
}

export function ytPlaylistId(value: string): string | null {
  try {
    const id = new URL(value).searchParams.get("list");
    return id && /^[\w-]{10,}$/.test(id) ? id : null;
  } catch {
    return /^[\w-]{10,}$/.test(value.trim()) ? value.trim() : null;
  }
}