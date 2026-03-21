import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { RoomProvider } from './contexts/RoomContext';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import Game from './pages/Game';
import Result from './pages/Result';
import Admin from './pages/Admin';

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
        <Route path="/admin" element={<Admin />} />
        <Route path="/:code/*" element={<RoomRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
