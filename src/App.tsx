import { useState, useEffect, useRef } from "react";
import "./App.css";

interface Message {
  id: string;
  username: string;
  color: string;
  text: string;
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

  const handleDrag = (e: React.MouseEvent) => {
    if (e.buttons === 1) {
      // getCurrentWindow().startDragging();
    }
  };

  const handleScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const connect = () => {
    if (!channel.trim()) return;

    const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send("PASS oauth:twitch");
      ws.send("NICK justinfan12345");
      ws.send("CAP REQ :twitch.tv/tags");
      ws.send(`JOIN #${channel.toLowerCase()}`);
      setConnected(true);
    };

    ws.onmessage = (event) => {
      const lines = event.data.split("\r\n");
      lines.forEach((line: string) => {
        if (line.includes("PING")) {
          ws.send("PONG :tmi.twitch.tv");
          return;
        }
        if (!line.includes("PRIVMSG")) return;

        // парсим теги
        const tagMatch = line.match(/^@([^ ]+)/);
        const tags: Record<string, string> = {};
        if (tagMatch) {
          tagMatch[1].split(";").forEach((tag) => {
            const [k, v] = tag.split("=");
            tags[k] = v;
          });
        }

        const usernameMatch = line.match(/:(\w+)!\w+@\w+\.tmi\.twitch\.tv/);
        const textMatch = line.match(/PRIVMSG #\w+ :(.+)/);

        if (usernameMatch && textMatch) {
          const msg: Message = {
            id: tags["id"] || Math.random().toString(),
            username: tags["display-name"] || usernameMatch[1],
            color: tags["color"] || "#9147ff",
            text: textMatch[1],
          };
          setMessages((prev) => [...prev.slice(-100), msg]);
        }
      });
    };
  };

  const disconnect = () => {
    wsRef.current?.close();
    setConnected(false);
    setMessages([]);
  };

  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  //когда мышь над сообщениями, клики работают, когда уходит за край — проваливаются сквозь:
  // useEffect(() => {
  //   const win = getCurrentWindow();
  //   const handleMouseLeave = () => win.setIgnoreCursorEvents(true);
  //   const handleMouseEnter = () => win.setIgnoreCursorEvents(false);

  //   document.addEventListener("mouseleave", handleMouseLeave);
  //   document.addEventListener("mouseenter", handleMouseEnter);

  //   return () => {
  //     document.removeEventListener("mouseleave", handleMouseLeave);
  //     document.removeEventListener("mouseenter", handleMouseEnter);
  //   };
  // }, []);

  return (
    <div className="app">
      {!connected ? (
        <div className="connect-screen" onMouseDown={handleDrag}>
          <h2>Twitch Chat</h2>
          <input
            type="text"
            placeholder="Название канала..."
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
          />
          <button onClick={connect}>Подключиться</button>
        </div>
      ) : (
        <div
          className="chat-screen"
          style={{ background: `rgba(0, 0, 0, ${opacity})` }}
        >
          <div className="chat-header" onMouseDown={handleDrag}>
            <span>#{channel}</span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setShowSettings(!showSettings)}>⚙️</button>
              <button onClick={disconnect}>✕</button>
            </div>
          </div>
          {showSettings && (
            <div className="settings">
              <label>
                Прозрачность фона
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </label>
              <label>
                Размер шрифта: {fontSize}px
                <input
                  type="range"
                  min="10"
                  max="20"
                  step="1"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
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
                <span className="username" style={{ color: msg.color }}>
                  {msg.username}
                </span>
                <span className="text">{msg.text}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
            {!autoScroll && (
              <button
                className="scroll-to-bottom"
                onClick={() => {
                  setAutoScroll(true);
                  messagesEndRef.current?.scrollIntoView({
                    behavior: "smooth",
                  });
                }}
              >
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
