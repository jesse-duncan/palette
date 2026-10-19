import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

export const App: React.FC = () => {
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [isShiftHeld, setIsShiftHeld] = useState<boolean>(false);

  const updatePassThrough = async (ignoreClicks: boolean) => {
    try {
      await invoke("set_click_through", { ignore: ignoreClicks });
    } catch (err) {
      console.error("Pass-through error:", err);
    }
  };

  useEffect(() => {
    let lastShiftTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Shift Deployment Controls (Single-hold or Double-tap lock)
      if (e.key === "Shift" && !e.repeat) {
        const currentTime = Date.now();
        if (currentTime - lastShiftTime < 300) {
          setIsLocked((prev) => {
            const nextState = !prev;
            updatePassThrough(!nextState);
            return nextState;
          });
        } else {
          setIsShiftHeld(true);
          if (!isLocked) {
            updatePassThrough(false);
          }
        }
        lastShiftTime = currentTime;
      }

      // Safeguard: Clear Canvas requires Shift + Delete or Shift + Backspace
      if ((e.key === "Delete" || e.key === "Backspace") && e.shiftKey) {
        console.log("Canvas clear requested with Shift + Delete/Backspace safeguard.");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setIsShiftHeld(false);
        if (!isLocked) {
          updatePassThrough(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isLocked]);

  const activeMode = isLocked || isShiftHeld;

  return (
    <div className={`overlay-root ${activeMode ? "interactive" : "pass-through"}`}>
      <div
        className="floating-toolbar"
        onMouseEnter={() => updatePassThrough(false)}
        onMouseLeave={() => {
          if (!activeMode) updatePassThrough(true);
        }}
      >
        <div className="drag-handle">⣿</div>
        <div className="brand-label">PALETTE</div>
        <div className="status-badge">
          {isLocked ? "🔒 LOCKED" : isShiftHeld ? "⚡ SHIFT ACTIVE" : "👁️ PASS-THROUGH"}
        </div>
      </div>
    </div>
  );
};

export default App;
