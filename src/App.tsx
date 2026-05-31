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

interface Message {
  id: string;
  username: string;
  color: string;
  text: string;
  badges: BadgeInfo[];
}

// set_id/version → image URL
type BadgeMap = Record<string, string>;

// Twitch's own web client ID — used for unauthenticated GQL requests, same as their website
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

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

  const handleDragMouseDown = (e: React.MouseEvent) => {
    let lastX = e.screenX;
    let lastY = e.screenY;
    const onMove = (e: MouseEvent) => {
      window.electronAPI?.mouseMove({ x: e.screenX - lastX, y: e.screenY - lastY });
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
          ...prev.slice(-100),
          {
            id: tags["id"] || Math.random().toString(),
            username: tags["display-name"] || userMatch[1],
            color: tags["color"] || "#9147ff",
            text: textMatch[1],
            badges,
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
  };

  useEffect(() => {
    if (autoScroll) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, autoScroll]);

  return (
    <div className="app">
      {!connected ? (
        <div className="connect-screen" onMouseDown={handleDragMouseDown}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>Chat Overlay</h2>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={() => window.electronAPI?.closeApp()}>✕</button>
          </div>
          <input
            type="text"
            placeholder="Название канала..."
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <button onMouseDown={(e) => e.stopPropagation()} onClick={connect}>Подключиться</button>
        </div>
      ) : (
        <div className="chat-screen" style={{ background: `rgba(0, 0, 0, ${opacity})` }}>
          <div className="chat-header" onMouseDown={handleDragMouseDown}>
            <span>#{channel}</span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowSettings(!showSettings)}>⚙️</button>
              <button onMouseDown={(e) => e.stopPropagation()} onClick={disconnect}>✕</button>
            </div>
          </div>

          {showSettings && (
            <div className="settings">
              <label>
                Прозрачность фона
                <input type="range" min="0.1" max="1" step="0.05" value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  onMouseDown={(e) => e.stopPropagation()} />
              </label>
              <label>
                Размер шрифта: {fontSize}px
                <input type="range" min="10" max="20" step="1" value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  onMouseDown={(e) => e.stopPropagation()} />
              </label>
            </div>
          )}

          <div className="messages" ref={messagesRef} onScroll={handleScroll} style={{ fontSize: `${fontSize}px` }}>
            {messages.map((msg) => (
              <div key={msg.id} className="message">
                {msg.badges.map(({ set_id, version }) => {
                  const url = badgeMap[`${set_id}/${version}`];
                  return url ? (
                    <img key={`${set_id}/${version}`} src={url} alt={set_id} className="badge" />
                  ) : null;
                })}
                <span className="username" style={{ color: msg.color }}>{msg.username}</span>
                <span className="text">{msg.text}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
            {!autoScroll && (
              <button className="scroll-to-bottom" onMouseDown={(e) => e.stopPropagation()}
                onClick={() => { setAutoScroll(true); messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }}>
                ↓ новые сообщения
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
