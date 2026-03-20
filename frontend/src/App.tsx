import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { RoomProvider } from './contexts/RoomContext';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import Game from './pages/Game';
import Result from './pages/Result';

function RoomRoutes() {
  const { code } = useParams<{ code: string }>();
  return (
    <RoomProvider code={code}>
      <Routes>
        <Route index element={<Lobby />} />
        <Route path="game" element={<Game />} />
        <Route path="result" element={<Result />} />
      </Routes>
    </RoomProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/:code/*" element={<RoomRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
