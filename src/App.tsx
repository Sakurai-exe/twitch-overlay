import { useState, useEffect, useRef } from "react";
import "./App.css";

declare global {
  interface Window {
    electronAPI?: {
      mouseMove: (delta: { x: number; y: number }) => void;
      closeApp: () => void;
    };
  }
}

interface BadgeInfo {
  set_id: string;
  version: string;
}

interface EmotePos {
  id: string;
  start: number;
  end: number;
}

interface Message {
  id: string;
  username: string;
  color: string;
  text: string;
  badges: BadgeInfo[];
  emotes: EmotePos[];
}

function toReadableColor(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return "#9147ff";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance >= 0.35) return hex;
  if (luminance === 0) return "#9147ff";
  const scale = 0.35 / luminance;
  return `rgb(${Math.min(255, Math.round(r * scale))}, ${Math.min(255, Math.round(g * scale))}, ${Math.min(255, Math.round(b * scale))})`;
}

function parseEmotes(emotesTag: string): EmotePos[] {
  if (!emotesTag) return [];
  const result: EmotePos[] = [];
  for (const part of emotesTag.split("/")) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;
    const id = part.slice(0, colonIdx);
    for (const range of part.slice(colonIdx + 1).split(",")) {
      const [s, e] = range.split("-").map(Number);
      result.push({ id, start: s, end: e });
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

function renderTextSegment(
  text: string,
  customEmotes: CustomEmoteMap,
  keyPrefix: number,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const words = text.split(" ");
  let buf = "";
  let bufKey = keyPrefix;

  const flushBuf = () => {
    if (buf) {
      parts.push(<span key={bufKey}>{buf}</span>);
      buf = "";
    }
  };

  words.forEach((word, i) => {
    const url = customEmotes[word];
    if (url) {
      flushBuf();
      parts.push(
        <img
          key={`${keyPrefix}-${i}`}
          src={url}
          alt={word}
          className="emote"
        />,
      );
    } else {
      buf += (buf ? " " : "") + word;
    }
  });

  flushBuf();
  return parts;
}

function renderText(
  text: string,
  emotes: EmotePos[],
  customEmotes: CustomEmoteMap,
) {
  const parts: React.ReactNode[] = [];
  // Twitch positions are codepoint-based — convert string to array of chars
  const chars = [...text];
  let cursor = 0;

  for (const { id, start, end } of emotes) {
    if (cursor < start) {
      const seg = chars.slice(cursor, start).join("");
      parts.push(...renderTextSegment(seg, customEmotes, cursor));
    }
    const emoteName = chars.slice(start, end + 1).join("");
    parts.push(
      <img
        key={start}
        src={`https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`}
        alt={emoteName}
        className="emote"
      />,
    );
    cursor = end + 1;
  }

  if (cursor < chars.length) {
    parts.push(
      ...renderTextSegment(chars.slice(cursor).join(""), customEmotes, cursor),
    );
  }

  return parts;
}

// set_id/version → image URL
type BadgeMap = Record<string, string>;

// Twitch's own web client ID — used for unauthenticated GQL requests, same as their website
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

// code → image URL (7TV + BTTV channel & global emotes)
type CustomEmoteMap = Record<string, string>;

async function loadCustomEmotes(roomId: string): Promise<CustomEmoteMap> {
  const map: CustomEmoteMap = {};

  await Promise.allSettled([
    // 7TV channel emotes (404 = channel has no 7TV account, skip silently)
    fetch(`https://7tv.io/v3/users/twitch/${roomId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        for (const e of d?.emote_set?.emotes ?? []) {
          const url = e?.data?.host?.url;
          if (e.name && url) map[e.name] = `https:${url}/2x.webp`;
        }
      }),
    // BTTV global emotes
    fetch("https://api.betterttv.net/3/cached/emotes/global")
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => {
        for (const e of list ?? []) {
          if (e.code && e.id)
            map[e.code] = `https://cdn.betterttv.net/emote/${e.id}/2x`;
        }
      }),
    // BTTV channel emotes
    fetch(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        for (const e of [
          ...(d?.channelEmotes ?? []),
          ...(d?.sharedEmotes ?? []),
        ]) {
          if (e.code && e.id)
            map[e.code] = `https://cdn.betterttv.net/emote/${e.id}/2x`;
        }
      }),
  ]);

  return map;
}

async function loadBadgesGQL(channelLogin: string): Promise<BadgeMap> {
  const res = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: {
      "Client-Id": GQL_CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `{
        badges {
          setID
          version
          imageURL(size: DOUBLE)
        }
        user(login: "${channelLogin}") {
          broadcastBadges {
            setID
            version
            imageURL(size: DOUBLE)
          }
        }
      }`,
    }),
  });

  if (!res.ok) throw new Error(`GQL ${res.status}`);
  const json = await res.json();

  const map: BadgeMap = {};

  for (const b of json.data?.badges ?? []) {
    if (b.setID && b.version != null && b.imageURL) {
      map[`${b.setID}/${b.version}`] = b.imageURL;
    }
  }
  for (const b of json.data?.user?.broadcastBadges ?? []) {
    if (b.setID && b.version != null && b.imageURL) {
      map[`${b.setID}/${b.version}`] = b.imageURL;
    }
  }

  return map;
}

function App() {
  const [channel, setChannel] = useState("");
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [opacity, setOpacity] = useState(0.75);
  const [fontSize, setFontSize] = useState(13);
  const [badgeMap, setBadgeMap] = useState<BadgeMap>({});
  const [customEmotes, setCustomEmotes] = useState<CustomEmoteMap>({});
  const customEmotesLoadedRef = useRef(false);
  const isProgrammaticScroll = useRef(false);

  const handleDragMouseDown = (e: React.MouseEvent) => {
    let lastX = e.screenX;
    let lastY = e.screenY;
    const onMove = (e: MouseEvent) => {
      window.electronAPI?.mouseMove({
        x: e.screenX - lastX,
        y: e.screenY - lastY,
      });
      lastX = e.screenX;
      lastY = e.screenY;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleScroll = () => {
    if (isProgrammaticScroll.current) return;
    const el = messagesRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 50);
  };

  const connect = () => {
    if (!channel.trim()) return;

    loadBadgesGQL(channel.trim().toLowerCase())
      .then((map) => setBadgeMap(map))
      .catch(console.error);

    const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send("PASS oauth:twitch");
      ws.send("NICK justinfan12345");
      ws.send(`JOIN #${channel.trim().toLowerCase()}`);
      setConnected(true);
    };

    ws.onmessage = (event) => {
      for (const line of (event.data as string).split("\r\n")) {
        if (line.startsWith("PING")) {
          ws.send("PONG :tmi.twitch.tv");
          continue;
        }
        if (!line.includes("PRIVMSG")) continue;

        const tags: Record<string, string> = {};
        const tagMatch = line.match(/^@([^ ]+)/);
        if (tagMatch) {
          for (const part of tagMatch[1].split(";")) {
            const eq = part.indexOf("=");
            if (eq !== -1) tags[part.slice(0, eq)] = part.slice(eq + 1);
          }
        }

        if (tags["room-id"] && !customEmotesLoadedRef.current) {
          customEmotesLoadedRef.current = true;
          loadCustomEmotes(tags["room-id"])
            .then(setCustomEmotes)
            .catch(console.error);
        }

        const userMatch = line.match(/:(\w+)!\w+@\w+\.tmi\.twitch\.tv/);
        const textMatch = line.match(/PRIVMSG #\w+ :(.+)/);
        if (!userMatch || !textMatch) continue;

        const badges: BadgeInfo[] = (tags["badges"] || "")
          .split(",")
          .filter(Boolean)
          .map((b) => {
            const slash = b.indexOf("/");
            return { set_id: b.slice(0, slash), version: b.slice(slash + 1) };
          });

        setMessages((prev) => [
          ...prev.slice(-50),
          {
            id: tags["id"] || Math.random().toString(),
            username: tags["display-name"] || userMatch[1],
            color: tags["color"] || "#9147ff",
            text: textMatch[1],
            badges,
            emotes: parseEmotes(tags["emotes"] || ""),
          },
        ]);
      }
    };
  };

  const disconnect = () => {
    wsRef.current?.close();
    setConnected(false);
    setMessages([]);
    setBadgeMap({});
    setCustomEmotes({});
    customEmotesLoadedRef.current = false;
  };

  useEffect(() => {
    if (autoScroll) {
      isProgrammaticScroll.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      requestAnimationFrame(() => {
        isProgrammaticScroll.current = false;
      });
    }
  }, [messages, autoScroll]);

  return (
    <div className="app">
      {!connected ? (
        <div className="connect-screen" onMouseDown={handleDragMouseDown}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h2>Stream Chat Overlay</h2>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => window.electronAPI?.closeApp()}
            >
              ✕
            </button>
          </div>
          <input
            type="text"
            placeholder="enter channel name..."
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <button onMouseDown={(e) => e.stopPropagation()} onClick={connect}>
            Connect to chat
          </button>
        </div>
      ) : (
        <div
          className="chat-screen"
          style={{ background: `rgba(0, 0, 0, ${opacity})` }}
        >
          <div className="chat-header" onMouseDown={handleDragMouseDown}>
            <span>Stream Chat Overlay</span>
            <span className="hotkey-hint">
              <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd>
              <span className="hotkey-hint-label">toggle click-through</span>
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setShowSettings(!showSettings)}
              >
                ⚙️
              </button>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={disconnect}
              >
                ✕
              </button>
            </div>
          </div>

          {showSettings && (
            <div className="settings">
              <label>
                Background transparency
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              </label>
              <label>
                Font size: {fontSize}px
                <input
                  type="range"
                  min="10"
                  max="20"
                  step="1"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              </label>
            </div>
          )}

          <div
            className="messages"
            ref={messagesRef}
            onScroll={handleScroll}
            style={{ fontSize: `${fontSize}px` }}
          >
            {messages.map((msg) => (
              <div key={msg.id} className="message">
                {msg.badges.map(({ set_id, version }) => {
                  const url = badgeMap[`${set_id}/${version}`];
                  return url ? (
                    <img
                      key={`${set_id}/${version}`}
                      src={url}
                      alt={set_id}
                      className="badge"
                    />
                  ) : null;
                })}
                <span
                  className="username"
                  style={{ color: toReadableColor(msg.color) }}
                >
                  {msg.username}
                </span>
                <span className="text">
                  {renderText(msg.text, msg.emotes, customEmotes)}
                </span>
              </div>
            ))}
            <div ref={messagesEndRef} />
            {!autoScroll && (
              <button
                className="scroll-to-bottom"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setAutoScroll(true);
                  messagesEndRef.current?.scrollIntoView({
                    behavior: "smooth",
                  });
                }}
              >
                ↓ new messages
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
