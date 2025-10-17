import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, ChevronLeft, ChevronRight, Heart, ThumbsDown, Radio, Mic } from "lucide-react";
import ChatPanel from "./ChatPanel";

// --- TYPE DEFINITIONS for props ---
// These define the "shape" of the data our component expects.
interface NowPlayingData {
  title: string;
  artist: string;
  elapsedSec: number;
  durationSec: number;
}

interface DJData {
  id: string;
  name: string;
  isCurrent: boolean;
}

interface ListenerData {
  id: string;
  name: string;
}

interface RoomSceneProps {
  nowPlaying: NowPlayingData | null;
  listeners: ListenerData[];
  djs: DJData[];
  onQueueTrack: () => void;
}


// ----------------------------
// Utility helpers
// ----------------------------
function fmtTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(1, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}


// ----------------------------
// Sub-components
// ----------------------------

function Avatar({ name, seed }: { name: string; seed: number }) {
  const delay = (seed % 7) * 0.1;
  return (
    <motion.div
      initial={{ y: 0, opacity: 0 }}
      animate={{ y: [0, -4, 0], opacity: 1 }}
      transition={{ repeat: Infinity, duration: 2 + (seed % 3), delay, ease: "easeInOut" }}
      className="flex flex-col items-center mx-3"
    >
      <div className="relative">
        <div className="h-8 w-8 rounded-t-full bg-zinc-200/90" />
        <div className="h-5 w-10 -mt-1 rounded-b-xl bg-zinc-400/80 mx-auto" />
        <div className="absolute inset-0 rounded-xl blur-md bg-fuchsia-500/10" />
      </div>
      <span className="mt-1 text-[10px] text-zinc-300/80 select-none max-w-12 truncate">
        {name}
      </span>
    </motion.div>
  );
}

function AudienceStrip({ listeners }: { listeners: ListenerData[] }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-28 flex justify-center items-end pb-2">
      <div className="flex">
        {listeners.map((l, i) => <Avatar key={l.id} name={l.name} seed={i} />)}
      </div>
    </div>
  );
}

function CollapsiblePanel({ listeners }: { listeners: ListenerData[] }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="absolute top-1/2 -translate-y-1/2 left-0 z-20">
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ duration: 0.3, ease: "easeInOut" }} className="w-64 h-[50vh] bg-black/40 backdrop-blur-sm rounded-r-lg shadow-2xl flex flex-col">
            <h3 className="text-sm font-semibold text-white/80 p-4 border-b border-white/10 flex items-center"><Users className="w-4 h-4 mr-2" /> In The Room ({listeners.length})</h3>
            <div className="flex-1 overflow-y-auto p-2">
              {listeners.map(l => (<div key={l.id} className="text-white/70 text-sm px-2 py-1.5 rounded-md hover:bg-white/10">{l.name}</div>))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={() => setIsOpen(!isOpen)} className="absolute top-1/2 -translate-y-1/2 -right-8 w-8 h-16 bg-black/40 backdrop-blur-sm rounded-r-lg text-white/50 hover:bg-black/60 hover:text-white flex items-center justify-center">
        {isOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </div>
  );
}

function ReactionBar() {
    return (
        <div className="flex items-center justify-center gap-4">
            <button className="px-4 py-1.5 bg-green-500/20 text-green-300 text-sm font-semibold rounded-full border border-green-500/30 hover:bg-green-500/30"><Heart className="w-4 h-4 inline-block mr-1" /> Awesome</button>
            <button className="px-4 py-1.5 bg-red-500/20 text-red-300 text-sm font-semibold rounded-full border border-red-500/30 hover:bg-red-500/30"><ThumbsDown className="w-4 h-4 inline-block mr-1" /> Lame</button>
        </div>
    );
}

function DJBooth({ nowPlaying, djs }: { nowPlaying: NowPlayingData | null, djs: DJData[] }) {
    if (!nowPlaying) {
      return (
        <div className="relative w-full max-w-2xl pt-20 pb-4 px-4">
          <div className="font-digital text-center text-xl text-orange-400/50">Waiting for track...</div>
        </div>
      );
    }
    const progress = (nowPlaying.elapsedSec / nowPlaying.durationSec) * 100;
    return (
        <div className="relative w-full max-w-2xl">
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 flex items-end gap-6">
                {djs.map(dj => (
                    <div key={dj.id} className="flex flex-col items-center">
                        {dj.isCurrent && <div className="text-xs text-yellow-300 font-bold mb-1 animate-pulse">ON AIR</div>}
                        <div className={`w-16 h-16 rounded-full bg-zinc-600 border-2 ${dj.isCurrent ? "border-yellow-400" : "border-zinc-500"}`} />
                        <span className="text-sm font-semibold text-white mt-2">{dj.name}</span>
                    </div>
                ))}
            </div>
            <div className="bg-gradient-to-b from-zinc-800 to-zinc-900 border-2 border-black rounded-t-xl shadow-2xl pt-20 pb-4 px-4">
                <div className="font-digital bg-black/50 border border-black rounded-md p-3 text-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.4)]">
                    <div className="text-center text-xl tracking-wider mb-2 flex items-center justify-center"><Radio size={16} className="mr-2 animate-pulse text-orange-500" /> {nowPlaying.title} - {nowPlaying.artist}</div>
                    <div className="relative">
                        <div className="flex justify-between text-lg mb-1">
                            <span>{fmtTime(nowPlaying.elapsedSec)}</span>
                            <span>{fmtTime(nowPlaying.durationSec)}</span>
                        </div>
                        <div className="w-full h-2 bg-orange-900/50 rounded-full">
                            <div className="h-full bg-orange-400 rounded-full" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                </div>
                <div className="mt-4"><ReactionBar /></div>
            </div>
        </div>
    );
}

// ----------------------------
// Main Scene Component
// ----------------------------
// FIX: This now accepts props and does NOT call useRoomState
export default function RoomScene({ nowPlaying, listeners, djs, onQueueTrack }: RoomSceneProps) {

  return (
    <div
      className="h-screen w-screen bg-cover bg-center flex flex-col overflow-hidden"
      style={{ backgroundImage: "url('/background.png')" }}
    >
      <div className="flex-1 flex items-center justify-center relative">
        <DJBooth nowPlaying={nowPlaying} djs={djs} />
      </div>
      <AudienceStrip listeners={listeners} />
      <CollapsiblePanel listeners={listeners} />
      <ChatPanel />

      <div className="absolute top-4 right-4 z-30 flex items-center gap-3">
        <button
          onClick={onQueueTrack}
          className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold px-5 py-3 rounded-lg shadow-lg border border-white/20 transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white/50 group flex items-center gap-2"
        >
          <Mic className="w-5 h-5 group-hover:rotate-12 transition-transform" />
          <span>Queue a Track</span>
        </button>
      </div>
    </div>
  );
}