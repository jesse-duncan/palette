import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type SymbolType = "resistor" | "ground" | "capacitor" | "diode" | "voltage";

interface StampObject {
  id: string;
  symbolType: SymbolType;
  xPct: number; // Normalized 0.0 - 1.0 (viewport relative)
  yPct: number;
  rotation: number; // 0, 90, 180, 270
  isFlipped: boolean;
  refDes: string;
  value: string;
}

export const App: React.FC = () => {
  // Mode & Focus States
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [isShiftHeld, setIsShiftHeld] = useState<boolean>(false);
  const [isSnapActive, setIsSnapActive] = useState<boolean>(true);

  // Phase 2 Tool States
  const [activeSymbol, setActiveSymbol] = useState<SymbolType | null>("resistor");
  const [rotation, setRotation] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [showHud, setShowHud] = useState<boolean>(false);

  // Stamp Stack & Undo / Redo Memory
  const [placedStamps, setPlacedStamps] = useState<StampObject[]>([]);
  const [redoStack, setRedoStack] = useState<StampObject[]>([]);

  // Refs for High-Performance Tracking
  const ghostRef = useRef<HTMLDivElement>(null);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const sKeyPressTimeRef = useRef<number>(0);

  const activeMode = isLocked || isShiftHeld;

  const updatePassThrough = async (ignoreClicks: boolean) => {
    try {
      await invoke("set_click_through", { ignore: ignoreClicks });
    } catch (err) {
      console.error("Pass-through error:", err);
    }
  };

  // High-FPS Hardware-Accelerated Ghost Pointer Tracking
  useEffect(() => {
    let animationFrameId: number;

    const handlePointerMove = (e: PointerEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };

      if (ghostRef.current && activeMode && activeSymbol) {
        animationFrameId = requestAnimationFrame(() => {
          if (ghostRef.current) {
            ghostRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0px) translate(-50%, -50%) rotate(${rotation}deg) scaleX(${isFlipped ? -1 : 1})`;
          }
        });
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, [activeMode, activeSymbol, rotation, isFlipped]);

  // Master Keyboard Control Matrix
  useEffect(() => {
    let lastShiftTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key shortcuts if focused inside an active input field
      if (document.activeElement?.tagName === "INPUT") return;

      // Shift Key Handling (Single-Hold or Double-Tap Lock)
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
          if (!isLocked) updatePassThrough(false);
        }
        lastShiftTime = currentTime;
      }

      // 'S' Key Timer Start
      if ((e.key === "s" || e.key === "S") && !e.repeat) {
        sKeyPressTimeRef.current = Date.now();
      }

      // 'F' Key: Mirror / Flip
      if ((e.key === "f" || e.key === "F") && !e.repeat) {
        setIsFlipped((prev) => !prev);
      }

      // 'Tab' Key: Snapping Toggle
      if (e.key === "Tab") {
        e.preventDefault();
        setIsSnapActive((prev) => !prev);
      }

      // Shift + Z (Undo)
      if (e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        setPlacedStamps((prev) => {
          if (prev.length === 0) return prev;
          const lastStamp = prev[prev.length - 1];
          setRedoStack((rPrev) => [...rPrev, lastStamp]);
          return prev.slice(0, prev.length - 1);
        });
      }

      // Shift + Y (Redo)
      if (e.shiftKey && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        setRedoStack((rPrev) => {
          if (rPrev.length === 0) return rPrev;
          const restoredStamp = rPrev[rPrev.length - 1];
          setPlacedStamps((pPrev) => [...pPrev, restoredStamp]);
          return rPrev.slice(0, rPrev.length - 1);
        });
      }

      // Shift + Delete / Backspace (Clear Canvas Safeguard)
      if (e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        setPlacedStamps([]);
        setRedoStack([]);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setIsShiftHeld(false);
        if (!isLocked) updatePassThrough(true);
      }

      // 'S' Key Timing Evaluation (< 200ms = 90° Rotate | >= 200ms = HUD)
      if (e.key === "s" || e.key === "S") {
        const pressDuration = Date.now() - sKeyPressTimeRef.current;
        if (pressDuration < 200) {
          setRotation((prev) => (prev + 90) % 360);
          setShowHud(false);
        } else {
          setShowHud((prev) => !prev);
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

  // Click Canvas to Stamp (Normalized Coordinates)
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!activeMode || !activeSymbol) return;
    if ((e.target as HTMLElement).closest(".floating-toolbar")) return;

    let targetX = e.clientX;
    let targetY = e.clientY;

    // Terminal Node Magnet Snapping (~12px threshold)
    if (isSnapActive && placedStamps.length > 0) {
      for (const stamp of placedStamps) {
        const stampX = stamp.xPct * window.innerWidth;
        const stampY = stamp.yPct * window.innerHeight;
        const dist = Math.hypot(targetX - stampX, targetY - stampY);
        if (dist < 12) {
          targetX = stampX;
          targetY = stampY;
          break;
        }
      }
    }

    const newStamp: StampObject = {
      id: `stamp-${Date.now()}`,
      symbolType: activeSymbol,
      xPct: targetX / window.innerWidth,
      yPct: targetY / window.innerHeight,
      rotation,
      isFlipped,
      refDes: `${activeSymbol.charAt(0).toUpperCase()}${placedStamps.length + 1}`,
      value: "",
    };

    setPlacedStamps((prev) => [...prev, newStamp]);
    setRedoStack([]); // Clear redo buffer on new action
  };

  // Right-Click Disarms Active Stamp Tool
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setActiveSymbol(null);
  };

  // High-Performance Dual-Path Vector Rendering (Contrast Halo)
  const renderSymbolGraphic = (type: SymbolType) => {
    const paths: Record<SymbolType, React.ReactNode> = {
      resistor: (
        <path d="M 0,20 L 10,20 L 13,10 L 19,30 L 25,10 L 31,30 L 37,10 L 43,30 L 47,20 L 60,20" />
      ),
      ground: (
        <g>
          <line x1="20" y1="0" x2="20" y2="20" />
          <line x1="5" y1="20" x2="35" y2="20" />
          <line x1="10" y1="27" x2="30" y2="27" />
          <line x1="15" y1="34" x2="25" y2="34" />
        </g>
      ),
      capacitor: (
        <g>
          <line x1="0" y1="20" x2="16" y2="20" />
          <line x1="16" y1="5" x2="16" y2="35" />
          <line x1="24" y1="5" x2="24" y2="35" />
          <line x1="24" y1="20" x2="40" y2="20" />
        </g>
      ),
      diode: (
        <g>
          <line x1="0" y1="20" x2="15" y2="20" />
          <polygon points="15,10 15,30 30,20" />
          <line x1="30" y1="8" x2="30" y2="32" />
          <line x1="30" y1="20" x2="45" y2="20" />
        </g>
      ),
      voltage: (
        <g>
          <line x1="0" y1="20" x2="10" y2="20" />
          <circle cx="25" cy="20" r="15" />
          <line x1="20" y1="13" x2="20" y2="27" />
          <line x1="13" y1="20" x2="27" y2="20" />
          <line x1="40" y1="20" x2="50" y2="20" />
        </g>
      ),
    };

    return (
      <g>
        {/* Background Contrast Halo Stroke */}
        <g stroke="#09090b" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {paths[type]}
        </g>
        {/* Foreground Primary Symbol Stroke */}
        <g stroke="#818cf8" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {paths[type]}
        </g>
      </g>
    );
  };

  return (
    <div
      className={`overlay-root ${activeMode ? "interactive" : "pass-through"}`}
      onClick={handleCanvasClick}
      onContextMenu={handleContextMenu}
    >
      {/* Floating Toolbar */}
      <div
        className="floating-toolbar"
        onMouseEnter={() => updatePassThrough(false)}
        onMouseLeave={() => {
          if (!activeMode) updatePassThrough(true);
        }}
      >
        <div className="drag-handle">⣿</div>
        <div className="brand-label">PALETTE</div>

        <button
          className={`snap-btn ${isSnapActive ? "active" : ""}`}
          onClick={() => setIsSnapActive((prev) => !prev)}
        >
          🧲 SNAP {isSnapActive ? "ON" : "OFF"}
        </button>

        {/* Quick Slot Symbols */}
        <div className="tool-selector">
          {(["resistor", "ground", "capacitor", "diode", "voltage"] as SymbolType[]).map((sym) => (
            <button
              key={sym}
              className={`tool-btn ${activeSymbol === sym ? "active" : ""}`}
              onClick={() => setActiveSymbol(sym)}
            >
              {sym.substring(0, 3).toUpperCase()}
            </button>
          ))}
        </div>

        <div className="status-badge">
          {isLocked ? "🔒 LOCKED" : isShiftHeld ? "⚡ SHIFT ACTIVE" : "👁️ PASS-THROUGH"}
        </div>
      </div>

      {/* Onshape-Style 'S' Hold Cursor Quick HUD */}
      {showHud && (
        <div
          className="cursor-hud"
          style={{ left: `${mousePosRef.current.x}px`, top: `${mousePosRef.current.y}px` }}
        >
          <div className="hud-header">FAVORITES & RECENTS</div>
          <div className="hud-grid">
            {(["resistor", "ground", "capacitor", "diode", "voltage"] as SymbolType[]).map((sym) => (
              <button
                key={sym}
                className="hud-btn"
                onClick={() => {
                  setActiveSymbol(sym);
                  setShowHud(false);
                }}
              >
                {sym.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Rendered Canvas Layer */}
      <svg className="stamp-canvas">
        {placedStamps.map((stamp) => {
          const absX = stamp.xPct * window.innerWidth;
          const absY = stamp.yPct * window.innerHeight;
          return (
            <g
              key={stamp.id}
              transform={`translate(${absX - 30}, ${absY - 20}) rotate(${stamp.rotation}, 30, 20) scale(${
                stamp.isFlipped ? -1 : 1
              }, 1)`}
            >
              {renderSymbolGraphic(stamp.symbolType)}
            </g>
          );
        })}
      </svg>

      {/* Active Cursor Ghost Preview */}
      {activeMode && activeSymbol && (
        <div ref={ghostRef} className="ghost-preview">
          <svg width="60" height="40" viewBox="0 0 60 40">
            {renderSymbolGraphic(activeSymbol)}
          </svg>
        </div>
      )}
    </div>
  );
};

export default App;
