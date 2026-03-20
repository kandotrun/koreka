import { createContext, useContext, useMemo } from 'react';
import { useRoom } from '../hooks/useRoom';

type RoomContextType = ReturnType<typeof useRoom>;

const RoomContext = createContext<RoomContextType | null>(null);

export function RoomProvider({ code, children }: { code: string | undefined; children: React.ReactNode }) {
  const room = useRoom(code);
  return <RoomContext.Provider value={room}>{children}</RoomContext.Provider>;
}

export function useRoomContext(): RoomContextType {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoomContext must be used within RoomProvider');
  return ctx;
}
