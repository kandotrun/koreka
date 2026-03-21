import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { I18nProvider } from './contexts/I18nContext';
import { RoomProvider } from './contexts/RoomContext';
import ErrorBoundary from './components/ErrorBoundary';
import LoadingScreen from './components/LoadingScreen';

const Home = lazy(() => import('./pages/Home'));
const Lobby = lazy(() => import('./pages/Lobby'));
const Game = lazy(() => import('./pages/Game'));
const Result = lazy(() => import('./pages/Result'));
const Admin = lazy(() => import('./pages/Admin'));

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
    <ErrorBoundary>
      <I18nProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/:code/*" element={<RoomRoutes />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </I18nProvider>
    </ErrorBoundary>
  );
}
