import { useState, useEffect, useRef } from "react";
import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

  const handleDrag = (e: React.MouseEvent) => {
    if (e.buttons === 1) {
      getCurrentWindow().startDragging();
    }
  };

  //когда мышь над сообщениями, клики работают, когда уходит за край — проваливаются сквозь:
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const win = getCurrentWindow();
    const handleMouseLeave = () => win.setIgnoreCursorEvents(true);
    const handleMouseEnter = () => win.setIgnoreCursorEvents(false);

    document.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("mouseenter", handleMouseEnter);

    return () => {
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("mouseenter", handleMouseEnter);
    };
  }, []);

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
        <div className="chat-screen">
          <div className="chat-header" onMouseDown={handleDrag}>
            <span>#{channel}</span>
            <button onClick={disconnect}>✕</button>
          </div>
          <div className="messages">
            {messages.map((msg) => (
              <div key={msg.id} className="message">
                <span className="username" style={{ color: msg.color }}>
                  {msg.username}
                </span>
                <span className="text">{msg.text}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
