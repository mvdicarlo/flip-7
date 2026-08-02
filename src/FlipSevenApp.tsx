import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clipboard,
  CloudOff,
  Crown,
  History,
  House,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MonitorUp,
  Play,
  RotateCcw,
  Share2,
  Target,
  Trophy,
  Undo2,
  UserMinus,
  Users,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'
import type {
  HandSelection,
  LobbyPlayer,
  LobbyView,
  PlayerRoundHand,
  PlayerSession,
  ScoreModifier,
} from '../shared/contracts'
import {
  calculateHandScore,
  NUMBER_CARDS,
  SCORE_MODIFIER_LABELS,
  SCORE_MODIFIERS,
} from '../shared/scoring'
import cardFan from './assets/card-fan.svg'
import {
  ApiClientError,
  createLobby,
  getLobby,
  joinLobby,
  recordLobbyRound,
  removeLobbyPlayer,
  restartLobbyGame,
  startLobbyGame,
  undoLobbyRound,
  updateLobbyHand,
} from './lib/api'
import { PollRequestGuard } from './lib/poll-request-guard'
import { getLobbySession, saveLobbySession } from './lib/session'
import './flip-seven.css'

type HomeMode = 'create' | 'join' | 'display'
type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'unavailable'

const RULES_PDF_URL =
  'https://cdn.shopify.com/s/files/1/0611/3958/3198/files/25_FLIP_7_TB_RULES_C_Rev_9_2_25_ND.pdf?v=1756935535'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/lobby/:code" element={<LobbyPage />} />
        <Route path="/display/:code" element={<DisplayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

function HomePage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<HomeMode>('create')
  const [hostName, setHostName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinName, setJoinName] = useState('')
  const [displayCode, setDisplayCode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const selectMode = (nextMode: HomeMode) => {
    setMode(nextMode)
    setError('')
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const result = await createLobby(hostName)
      saveLobbySession(result.session)
      navigate(`/lobby/${result.lobby.code}`)
    } catch (requestError) {
      setError(toErrorMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const result = await joinLobby(joinCode, joinName)
      saveLobbySession(result.session)
      navigate(`/lobby/${result.lobby.code}`)
    } catch (requestError) {
      setError(toErrorMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDisplay = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigate(`/display/${displayCode}`)
  }

  return (
    <div className="app-shell home-shell">
      <SiteHeader />
      <main className="home-main">
        <section className="home-visual" aria-labelledby="home-title">
          <p className="kicker">Lobby scorekeeper</p>
          <h1 id="home-title" className="wordmark">
            <span>Flip</span>
            <strong>7</strong>
          </h1>
          <p className="home-tagline">Bring the table together.</p>
          <img
            className="card-fan"
            src={cardFan}
            width="640"
            height="360"
            alt=""
          />
        </section>

        <section className="action-panel" aria-labelledby="action-title">
          <div className="mode-switch" role="tablist" aria-label="Lobby action">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'create'}
              className={mode === 'create' ? 'is-active' : ''}
              onClick={() => selectMode('create')}
            >
              Create
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'join'}
              className={mode === 'join' ? 'is-active' : ''}
              onClick={() => selectMode('join')}
            >
              Join
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'display'}
              className={mode === 'display' ? 'is-active' : ''}
              onClick={() => selectMode('display')}
            >
              Display
            </button>
          </div>

          {mode === 'create' ? (
            <form className="lobby-form" onSubmit={handleCreate}>
              <div className="panel-heading">
                <span className="panel-number">01</span>
                <div>
                  <p className="eyebrow">New lobby</p>
                  <h2 id="action-title">Who is hosting?</h2>
                </div>
              </div>
              <Field
                id="host-name"
                label="Your name"
                value={hostName}
                onChange={setHostName}
                autoComplete="nickname"
                placeholder="Enter a display name"
                maxLength={24}
                autoFocus
              />
              <FormError message={error} />
              <SubmitButton
                label="Create lobby"
                busyLabel="Creating lobby"
                isSubmitting={isSubmitting}
                disabled={!hostName.trim()}
              />
            </form>
          ) : mode === 'join' ? (
            <form className="lobby-form" onSubmit={handleJoin}>
              <div className="panel-heading">
                <span className="panel-number panel-number-teal">02</span>
                <div>
                  <p className="eyebrow">Join a table</p>
                  <h2 id="action-title">Enter your details</h2>
                </div>
              </div>
              <div className="field-row">
                <Field
                  id="join-code"
                  label="Lobby code"
                  value={joinCode}
                  onChange={(value) => setJoinCode(normalizeCodeInput(value))}
                  autoComplete="off"
                  placeholder="ABCDE"
                  maxLength={5}
                  inputMode="text"
                  code
                  autoFocus
                />
                <Field
                  id="join-name"
                  label="Your name"
                  value={joinName}
                  onChange={setJoinName}
                  autoComplete="nickname"
                  placeholder="Display name"
                  maxLength={24}
                />
              </div>
              <FormError message={error} />
              <SubmitButton
                label="Join lobby"
                busyLabel="Joining lobby"
                isSubmitting={isSubmitting}
                disabled={joinCode.length !== 5 || !joinName.trim()}
              />
            </form>
          ) : (
            <form className="lobby-form" onSubmit={handleDisplay}>
              <div className="panel-heading">
                <span className="panel-number panel-number-blue">03</span>
                <div>
                  <p className="eyebrow">Room display</p>
                  <h2 id="action-title">Open a guest view</h2>
                </div>
              </div>
              <Field
                id="display-code"
                label="Lobby code"
                value={displayCode}
                onChange={(value) =>
                  setDisplayCode(normalizeCodeInput(value))
                }
                autoComplete="off"
                placeholder="ABCDE"
                maxLength={5}
                inputMode="text"
                code
                autoFocus
              />
              <button
                className="primary-button"
                type="submit"
                disabled={displayCode.length !== 5}
              >
                <span>Open display</span>
                <MonitorUp aria-hidden="true" />
              </button>
            </form>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

function JoinPage() {
  const { code: routeCode = '' } = useParams()
  const code = normalizeCodeInput(routeCode)

  return <JoinPageContent key={code} code={code} />
}

function JoinPageContent({ code }: { code: string }) {
  const navigate = useNavigate()
  const savedPlayerId = getLobbySession(code)?.playerId
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [existingPlayer, setExistingPlayer] = useState<
    LobbyPlayer | null | undefined
  >(() => (savedPlayerId && code.length === 5 ? undefined : null))
  const [showJoinForm, setShowJoinForm] = useState(
    () => !savedPlayerId || code.length !== 5,
  )

  useEffect(() => {
    if (!savedPlayerId || code.length !== 5) {
      return
    }

    let isCurrent = true

    const findExistingPlayer = async () => {
      try {
        const lobby = await getLobby(code)

        if (!isCurrent) {
          return
        }

        const player =
          lobby.players.find(
            (lobbyPlayer) => lobbyPlayer.id === savedPlayerId,
          ) ?? null
        setExistingPlayer(player)
        setShowJoinForm(!player)
      } catch (requestError) {
        if (isCurrent) {
          setExistingPlayer(null)
          setShowJoinForm(true)
          setError(toErrorMessage(requestError))
        }
      }
    }

    void findExistingPlayer()

    return () => {
      isCurrent = false
    }
  }, [code, savedPlayerId])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const result = await joinLobby(code, name)
      saveLobbySession(result.session)
      navigate(`/lobby/${result.lobby.code}`)
    } catch (requestError) {
      setError(toErrorMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const showDifferentPlayerForm = () => {
    setError('')
    setName('')
    setShowJoinForm(true)
  }

  return (
    <div className="app-shell join-shell">
      <SiteHeader />
      <main className="join-main">
        <Link className="text-link" to="/">
          <ArrowLeft aria-hidden="true" />
          Home
        </Link>
        <section className="action-panel join-panel" aria-labelledby="join-title">
          <p className="eyebrow">You are joining</p>
          <div className="join-code" aria-label={`Lobby code ${code}`}>
            {code || '-----'}
          </div>
          {existingPlayer === undefined ? (
            <div className="lobby-form rejoin-check" aria-live="polite">
              <LoaderCircle className="loading-icon" aria-hidden="true" />
              <h1 id="join-title">Checking your seat</h1>
            </div>
          ) : existingPlayer && !showJoinForm ? (
            <div className="lobby-form rejoin-prompt">
              <div className="rejoin-identity">
                <span className="player-token token-0" aria-hidden="true">
                  {existingPlayer.name.charAt(0).toUpperCase()}
                </span>
                <div>
                  <p className="eyebrow">Welcome back</p>
                  <h1 id="join-title">Rejoin as {existingPlayer.name}?</h1>
                </div>
              </div>
              <p className="rejoin-description">
                Your seat is still saved on this device.
              </p>
              <div className="rejoin-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => navigate(`/lobby/${code}`)}
                >
                  <span>Rejoin as {existingPlayer.name}</span>
                  <ArrowRight aria-hidden="true" />
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={showDifferentPlayerForm}
                >
                  <Users aria-hidden="true" />
                  <span>Join as someone else</span>
                </button>
              </div>
            </div>
          ) : (
            <form className="lobby-form" onSubmit={handleSubmit}>
              <h1 id="join-title">
                {existingPlayer
                  ? 'Join as someone else'
                  : 'Pick your table name'}
              </h1>
              <Field
                id="player-name"
                label="Your name"
                value={name}
                onChange={setName}
                autoComplete="nickname"
                placeholder="Enter a display name"
                maxLength={24}
                autoFocus
              />
              <FormError message={error} />
              <SubmitButton
                label="Take a seat"
                busyLabel="Joining lobby"
                isSubmitting={isSubmitting}
                disabled={code.length !== 5 || !name.trim()}
              />
              {existingPlayer && (
                <button
                  className="rejoin-instead-button"
                  type="button"
                  onClick={() => setShowJoinForm(false)}
                >
                  <RotateCcw aria-hidden="true" />
                  Rejoin as {existingPlayer.name} instead
                </button>
              )}
            </form>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

function DisplayPage() {
  const { code: routeCode = '' } = useParams()
  const code = normalizeCodeInput(routeCode)
  const [lobby, setLobby] = useState<LobbyView | null>(null)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting')
  const pollRequestGuard = useRef(new PollRequestGuard())

  useEffect(() => {
    let isCurrent = true

    const refreshLobby = async () => {
      const request = pollRequestGuard.current.begin()

      try {
        const nextLobby = await getLobby(code)

        if (!isCurrent || !pollRequestGuard.current.isCurrent(request)) {
          return
        }

        setLobby(nextLobby)
        setError('')
        setConnectionState('live')
      } catch (requestError) {
        if (isCurrent && pollRequestGuard.current.isCurrent(request)) {
          setError(toErrorMessage(requestError))
          setConnectionState(
            requestError instanceof ApiClientError &&
              requestError.code === 'LOBBY_NOT_FOUND'
              ? 'unavailable'
              : 'reconnecting',
          )
        }
      }
    }

    void refreshLobby()
    const interval = window.setInterval(() => void refreshLobby(), 1_000)

    return () => {
      isCurrent = false
      window.clearInterval(interval)
    }
  }, [code, refreshVersion])

  useEffect(() => {
    const updateFullscreenState = () =>
      setIsFullscreen(Boolean(document.fullscreenElement))

    document.addEventListener('fullscreenchange', updateFullscreenState)
    return () =>
      document.removeEventListener('fullscreenchange', updateFullscreenState)
  }, [])

  const toggleFullscreen = () => {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen()

    void request.catch(() => undefined)
  }

  if (!lobby && error) {
    return (
      <div className="app-shell display-shell">
        <SiteHeader />
        <main className="state-page">
          <p className="eyebrow">Display unavailable</p>
          <h1>{error}</h1>
          <div className="state-actions">
            <button
              className="primary-button compact-button"
              type="button"
              onClick={() => setRefreshVersion((version) => version + 1)}
            >
              Try again
            </button>
            <Link className="secondary-button compact-button" to="/">
              <House aria-hidden="true" />
              Home
            </Link>
          </div>
        </main>
      </div>
    )
  }

  if (!lobby) {
    return (
      <div className="app-shell display-shell">
        <main className="display-loading" aria-live="polite">
          <LoaderCircle className="loading-icon" aria-hidden="true" />
          <h1>Opening display</h1>
          <p>Lobby {code}</p>
        </main>
      </div>
    )
  }

  const game = lobby.game
  const projectedScore = (player: LobbyView['players'][number]) =>
    player.score + (lobby.status === 'active' ? player.hand.points : 0)
  const standings = [...lobby.players].sort(
    (left, right) =>
      projectedScore(right) - projectedScore(left) ||
      left.joinedAt.localeCompare(right.joinedAt),
  )
  const playersById = new Map(
    lobby.players.map((player) => [player.id, player]),
  )
  const winnerNames = (game?.winnerIds ?? [])
    .map((playerId) => playersById.get(playerId)?.name)
    .filter((name): name is string => Boolean(name))
  const readyCount = lobby.players.filter((player) => player.hand.ready).length
  const latestRound = game?.rounds.at(-1)
  const inviteUrl = `${window.location.origin}/join/${code}`

  return (
    <div className={`app-shell display-shell display-${lobby.status}`}>
      <header className="display-header">
        <Link className="brand" to="/" aria-label="Flip Seven home">
          <span className="brand-card">7</span>
          <span>Flip Seven</span>
        </Link>
        <div className="display-header-actions">
          <RulesLink />
          <span
            className={`status-chip game-status ${lobby.status} connection-${connectionState}`}
          >
            <span aria-hidden="true" />
            {connectionLabel(
              connectionState,
              lobby.status === 'waiting'
                ? 'Lobby open'
                : lobby.status === 'finished'
                  ? 'Final'
                  : 'Live',
            )}
          </span>
          {document.fullscreenEnabled && (
            <button
              className="display-fullscreen-button"
              type="button"
              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 aria-hidden="true" />
              ) : (
                <Maximize2 aria-hidden="true" />
              )}
              <span>{isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
            </button>
          )}
        </div>
      </header>

      <main className="display-main">
        <ConnectionBanner state={connectionState} message={error} />

        {lobby.status === 'waiting' || !game ? (
          <>
            <section className="display-waiting-hero">
              <div>
                <p className="kicker">Lobby {lobby.code}</p>
                <h1>Join the table</h1>
                <strong className="display-code">{lobby.code}</strong>
                <p>Scan with your phone or enter the code to join.</p>
              </div>
              <div className="display-qr-frame">
                <QRCodeSVG
                  value={inviteUrl}
                  size={240}
                  level="M"
                  marginSize={2}
                  bgColor="#ffffff"
                  fgColor="#191a1f"
                  title={`Join lobby ${lobby.code}`}
                />
              </div>
            </section>

            <section
              className="display-waiting-players"
              aria-labelledby="display-players-title"
            >
              <div className="display-section-heading">
                <div>
                  <p className="eyebrow">At the table</p>
                  <h2 id="display-players-title">Players</h2>
                </div>
                <span>{lobby.players.length} joined</span>
              </div>
              <ul>
                {lobby.players.map((player, index) => (
                  <li key={player.id}>
                    <span
                      className={`player-token token-${index % 4}`}
                      aria-hidden="true"
                    >
                      {player.name.charAt(0).toUpperCase()}
                    </span>
                    <strong>{player.name}</strong>
                    {player.role === 'host' && (
                      <span className="host-badge">
                        <Crown aria-hidden="true" />
                        Host
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : (
          <>
            <section className="display-game-heading">
              <div>
                <p className="kicker">Game {lobby.code}</p>
                <h1>
                  {lobby.status === 'finished'
                    ? 'Game complete'
                    : `Round ${game.roundNumber}`}
                </h1>
              </div>
              <div className="display-round-meta">
                <Users aria-hidden="true" />
                <span>
                  {lobby.status === 'finished'
                    ? `${lobby.players.length} players`
                    : `${readyCount} of ${lobby.players.length} ready`}
                </span>
              </div>
            </section>

            {lobby.status === 'finished' && (
              <section
                className="display-winner-banner"
                aria-labelledby="display-winner-title"
              >
                <Trophy aria-hidden="true" />
                <div>
                  <p className="eyebrow">
                    {winnerNames.length === 1 ? 'Winner' : 'Winners'}
                  </p>
                  <h2 id="display-winner-title">
                    {winnerNames.join(' & ')}
                  </h2>
                </div>
                <strong>{standings[0]?.score ?? 0}</strong>
              </section>
            )}

            <ol className="display-scoreboard" aria-label="Standings">
              {standings.map((player, index) => {
                const liveTotal = projectedScore(player)

                return (
                  <li
                    className={`${player.hand.ready ? 'hand-ready' : ''} ${
                      player.hand.busted ? 'hand-busted' : ''
                    }`}
                    key={player.id}
                  >
                    <span className="display-rank">{index + 1}</span>
                    <div className="display-player-heading">
                      <span
                        className={`player-token token-${index % 4}`}
                        aria-hidden="true"
                      >
                        {player.name.charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <h2>{player.name}</h2>
                        {lobby.status === 'active' && (
                          <span className="display-hand-state">
                            {player.hand.busted
                              ? 'Busted'
                              : player.hand.ready
                                ? 'Ready'
                                : 'Choosing cards'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="display-player-score">
                      <strong>{liveTotal}</strong>
                      <span>
                        {lobby.status === 'active' ? 'Projected' : 'Total'}
                      </span>
                    </div>
                    {lobby.status === 'active' && (
                      <>
                        <HandChips hand={player.hand} />
                        <div className="display-score-detail">
                          <span>
                            Banked <b>{player.score}</b>
                          </span>
                          <span>
                            This round <b>+{player.hand.points}</b>
                          </span>
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ol>

            {latestRound && (
              <section className="display-last-round" aria-label="Last round">
                <span>
                  <History aria-hidden="true" />
                  Round {latestRound.number}
                </span>
                <div>
                  {latestRound.scores.map((score) => (
                    <span key={score.playerId}>
                      {score.playerName ??
                        playersById.get(score.playerId)?.name}{' '}
                      <b>+{score.points}</b>
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function LobbyPage() {
  const { code: routeCode = '' } = useParams()
  const code = normalizeCodeInput(routeCode)
  const [lobby, setLobby] = useState<LobbyView | null>(null)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState('')
  const [removingPlayerId, setRemovingPlayerId] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting')
  const pollRequestGuard = useRef(new PollRequestGuard())

  useEffect(() => {
    let isCurrent = true

    const refreshLobby = async () => {
      const request = pollRequestGuard.current.begin()

      try {
        const nextLobby = await getLobby(code)

        if (!isCurrent || !pollRequestGuard.current.isCurrent(request)) {
          return
        }

        setLobby(nextLobby)
        setError('')
        setConnectionState('live')
      } catch (requestError) {
        if (isCurrent && pollRequestGuard.current.isCurrent(request)) {
          setError(toErrorMessage(requestError))
          setConnectionState(
            requestError instanceof ApiClientError &&
              requestError.code === 'LOBBY_NOT_FOUND'
              ? 'unavailable'
              : 'reconnecting',
          )
        }
      }
    }

    void refreshLobby()
    const interval = window.setInterval(() => void refreshLobby(), 1_000)

    return () => {
      isCurrent = false
      window.clearInterval(interval)
    }
  }, [code, refreshVersion])

  const inviteUrl = `${window.location.origin}/join/${code}`
  const session = getLobbySession(code)
  const isConnected = connectionState === 'live'
  const applyLobbyMutation = (nextLobby: LobbyView) => {
    pollRequestGuard.current.invalidate()
    setLobby(nextLobby)
  }

  const showCopied = () => {
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_800)
  }

  const copyCode = async () => {
    await navigator.clipboard.writeText(code)
    showCopied()
  }

  const shareInvite = async () => {
    if (navigator.share) {
      await navigator.share({
        title: `Join Flip Seven lobby ${code}`,
        text: `Join my Flip Seven lobby with code ${code}.`,
        url: inviteUrl,
      })
      return
    }

    await navigator.clipboard.writeText(inviteUrl)
    showCopied()
  }

  const handleRemovePlayer = async (playerId: string, playerName: string) => {
    const confirmationMessage =
      lobby?.status === 'active'
        ? `Remove ${playerName} from this game? Their current hand will be discarded, but completed rounds will stay in history.`
        : `Remove ${playerName} from this lobby?`

    if (
      session?.role !== 'host' ||
      !isConnected ||
      removingPlayerId ||
      !window.confirm(confirmationMessage)
    ) {
      return
    }

    setActionError('')
    setRemovingPlayerId(playerId)

    try {
      const nextLobby = await removeLobbyPlayer(
        code,
        playerId,
        session.token,
      )
      applyLobbyMutation(nextLobby)
    } catch (requestError) {
      setActionError(toErrorMessage(requestError))
    } finally {
      setRemovingPlayerId(null)
    }
  }

  const handleStartGame = async () => {
    if (
      session?.role !== 'host' ||
      !isConnected ||
      isStarting ||
      !lobby ||
      lobby.players.length < 2
    ) {
      return
    }

    setActionError('')
    setIsStarting(true)

    try {
      applyLobbyMutation(await startLobbyGame(code, session.token))
    } catch (requestError) {
      setActionError(toErrorMessage(requestError))
    } finally {
      setIsStarting(false)
    }
  }

  if (!lobby && error) {
    return (
      <div className="app-shell lobby-shell">
        <SiteHeader />
        <main className="state-page">
          <p className="eyebrow">Lobby unavailable</p>
          <h1>{error}</h1>
          <div className="state-actions">
            <button
              className="primary-button compact-button"
              type="button"
              onClick={() => setRefreshVersion((version) => version + 1)}
            >
              Try again
            </button>
            <Link className="secondary-button compact-button" to="/">
              <House aria-hidden="true" />
              Home
            </Link>
          </div>
        </main>
      </div>
    )
  }

  if (!lobby) {
    return (
      <div className="app-shell lobby-shell">
        <SiteHeader />
        <main className="state-page" aria-live="polite">
          <LoaderCircle className="loading-icon" aria-hidden="true" />
          <h1>Opening lobby</h1>
        </main>
      </div>
    )
  }

  if (
    session?.role === 'player' &&
    !lobby.players.some((player) => player.id === session.playerId)
  ) {
    return (
      <div className="app-shell lobby-shell">
        <SiteHeader />
        <main className="state-page">
          <p className="eyebrow">Seat released</p>
          <h1>
            You were removed from this{' '}
            {lobby.status === 'waiting' ? 'lobby' : 'game'}.
          </h1>
          <div className="state-actions">
            {lobby.status === 'waiting' && (
              <Link
                className="primary-button compact-button"
                to={`/join/${code}`}
              >
                Join again
              </Link>
            )}
            <Link className="secondary-button compact-button" to="/">
              <House aria-hidden="true" />
              Home
            </Link>
          </div>
        </main>
      </div>
    )
  }

  if (lobby.status !== 'waiting' && lobby.game) {
    return (
      <GamePage
        key={`${lobby.status}:${lobby.game.runId}:${lobby.game.roundNumber}`}
        lobby={lobby}
        session={session}
        connectionState={connectionState}
        connectionMessage={error}
        removingPlayerId={removingPlayerId}
        removeError={actionError}
        onLobbyChange={applyLobbyMutation}
        onRemovePlayer={handleRemovePlayer}
      />
    )
  }

  return (
    <div className="app-shell lobby-shell">
      <SiteHeader />
      <main className="lobby-main">
        <div className="lobby-heading">
          <div>
            <p className="kicker">Waiting room</p>
            <h1>{session?.role === 'host' ? 'Your lobby is open' : 'You are in'}</h1>
          </div>
          <div className="heading-actions">
            <Link
              className="display-launch-link"
              to={`/display/${lobby.code}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open room display"
              title="Open room display"
            >
              <MonitorUp aria-hidden="true" />
              <span>Display</span>
            </Link>
            <span className={`status-chip connection-${connectionState}`}>
              <span aria-hidden="true" />
              {connectionLabel(connectionState, 'Live')}
            </span>
          </div>
        </div>

        <ConnectionBanner state={connectionState} message={error} />

        <section className="code-banner" aria-labelledby="lobby-code-title">
          <div>
            <p id="lobby-code-title">Lobby code</p>
            <strong>{lobby.code}</strong>
          </div>
          <button className="copy-button" type="button" onClick={copyCode}>
            {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </section>

        <div className="lobby-grid">
          <section className="invite-pane" aria-labelledby="invite-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Invite players</p>
                <h2 id="invite-title">Scan to join</h2>
              </div>
              <Share2 aria-hidden="true" />
            </div>
            <div className="qr-frame">
              <QRCodeSVG
                value={inviteUrl}
                size={184}
                level="M"
                marginSize={2}
                bgColor="#ffffff"
                fgColor="#191a1f"
                title={`Join lobby ${lobby.code}`}
              />
            </div>
            <button className="secondary-button share-button" type="button" onClick={shareInvite}>
              <Share2 aria-hidden="true" />
              Share invite
            </button>
          </section>

          <section className="players-pane" aria-labelledby="players-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">At the table</p>
                <h2 id="players-title">Players</h2>
              </div>
              <span className="player-count" aria-label={`${lobby.players.length} players`}>
                <Users aria-hidden="true" />
                {lobby.players.length}
              </span>
            </div>
            <ol className="player-list">
              {lobby.players.map((player, index) => (
                <li key={player.id}>
                  <span className={`player-token token-${index % 4}`} aria-hidden="true">
                    {player.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="player-name">
                    {player.name}
                    {player.id === session?.playerId && <small>You</small>}
                  </span>
                  {player.role === 'host' ? (
                    <span className="host-badge">
                      <Crown aria-hidden="true" />
                      Host
                    </span>
                  ) : session?.role === 'host' ? (
                    <button
                      className="remove-player-button"
                      type="button"
                      aria-label={`Remove ${player.name}`}
                      title={`Remove ${player.name}`}
                      disabled={!isConnected || removingPlayerId !== null}
                      onClick={() => handleRemovePlayer(player.id, player.name)}
                    >
                      {removingPlayerId === player.id ? (
                        <LoaderCircle className="button-spinner" aria-hidden="true" />
                      ) : (
                        <UserMinus aria-hidden="true" />
                      )}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
            <FormError message={actionError} />
            {session?.role === 'host' && (
              <button
                className="primary-button start-game-button"
                type="button"
                disabled={
                  !isConnected || lobby.players.length < 2 || isStarting
                }
                onClick={handleStartGame}
              >
                <span>{isStarting ? 'Starting game' : 'Start game'}</span>
                {isStarting ? (
                  <LoaderCircle className="button-spinner" aria-hidden="true" />
                ) : (
                  <Play aria-hidden="true" />
                )}
              </button>
            )}
            <p className="waiting-note" aria-live="polite">
              <span aria-hidden="true" />
              {lobby.players.length < 2
                ? 'Waiting for one more player'
                : session?.role === 'host'
                  ? 'Table is ready'
                  : 'Waiting for the host to start'}
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

interface GamePageProps {
  lobby: LobbyView
  session: PlayerSession | null
  connectionState: ConnectionState
  connectionMessage: string
  removingPlayerId: string | null
  removeError: string
  onLobbyChange: (lobby: LobbyView) => void
  onRemovePlayer: (playerId: string, playerName: string) => Promise<void>
}

function GamePage({
  lobby,
  session,
  connectionState,
  connectionMessage,
  removingPlayerId,
  removeError,
  onLobbyChange,
  onRemovePlayer,
}: GamePageProps) {
  const game = lobby.game
  const currentPlayer = lobby.players.find(
    (player) => player.id === session?.playerId,
  )
  const [draftHand, setDraftHand] = useState<PlayerRoundHand | null>(
    () => currentPlayer?.hand ?? null,
  )
  const [handError, setHandError] = useState('')
  const [handSaveState, setHandSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [roundError, setRoundError] = useState('')
  const [isCompletingRound, setIsCompletingRound] = useState(false)
  const [undoError, setUndoError] = useState('')
  const [isUndoingRound, setIsUndoingRound] = useState(false)
  const [restartError, setRestartError] = useState('')
  const [isRestartingGame, setIsRestartingGame] = useState(false)
  const handSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const handSaveVersion = useRef(0)

  if (!game) {
    return null
  }

  const displayedPlayers = lobby.players.map((player) =>
    player.id === currentPlayer?.id && draftHand
      ? { ...player, hand: draftHand }
      : player,
  )
  const projectedScore = (player: (typeof displayedPlayers)[number]) =>
    player.score + (lobby.status === 'active' ? player.hand.points : 0)
  const standings = [...displayedPlayers].sort(
    (left, right) =>
      projectedScore(right) - projectedScore(left) ||
      left.joinedAt.localeCompare(right.joinedAt),
  )
  const playersById = new Map(
    lobby.players.map((player) => [player.id, player]),
  )
  const winnerNames = game.winnerIds
    .map((playerId) => playersById.get(playerId)?.name)
    .filter((name): name is string => Boolean(name))
  const readyCount = lobby.players.filter((player) => player.hand.ready).length
  const allHandsReady = readyCount === lobby.players.length
  const isConnected = connectionState === 'live'
  const latestRound = game.rounds.at(-1)
  const currentRoundHasChanges =
    lobby.status === 'active' &&
    lobby.players.some((player) => player.hand.updatedAt !== null)
  const canUndoRound = Boolean(latestRound) && !currentRoundHasChanges

  const persistHand = (nextHand: HandSelection & { ready: boolean }) => {
    if (
      !session ||
      !currentPlayer ||
      lobby.status !== 'active' ||
      !isConnected
    ) {
      return
    }

    const score = calculateHandScore(nextHand)
    const optimisticHand: PlayerRoundHand = {
      ...nextHand,
      points: score.points,
      hasFlip7: score.hasFlip7,
      updatedAt: new Date().toISOString(),
    }
    const version = handSaveVersion.current + 1
    handSaveVersion.current = version
    setDraftHand(optimisticHand)
    setHandError('')
    setHandSaveState('saving')

    handSaveQueue.current = handSaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const nextLobby = await updateLobbyHand(
          lobby.code,
          nextHand,
          game.runId,
          session.token,
        )
        onLobbyChange(nextLobby)

        if (version === handSaveVersion.current) {
          const savedPlayer = nextLobby.players.find(
            (player) => player.id === currentPlayer.id,
          )
          setDraftHand(savedPlayer?.hand ?? optimisticHand)
          setHandSaveState('saved')
        }
      })
      .catch((requestError: unknown) => {
        if (version === handSaveVersion.current) {
          setHandError(toErrorMessage(requestError))
          setHandSaveState('error')
          setDraftHand((currentHand) =>
            currentHand ? { ...currentHand, ready: false } : currentHand,
          )
        }
      })
  }

  const handleRoundComplete = async () => {
    if (
      session?.role !== 'host' ||
      lobby.status !== 'active' ||
      !allHandsReady ||
      isCompletingRound ||
      !isConnected
    ) {
      return
    }

    setRoundError('')
    setIsCompletingRound(true)

    try {
      onLobbyChange(
        await recordLobbyRound(lobby.code, game.runId, session.token),
      )
    } catch (requestError) {
      setRoundError(toErrorMessage(requestError))
    } finally {
      setIsCompletingRound(false)
    }
  }

  const handleUndoRound = async () => {
    if (
      session?.role !== 'host' ||
      !latestRound ||
      !canUndoRound ||
      !isConnected ||
      isUndoingRound ||
      !window.confirm(
        `Undo round ${latestRound.number}? Its points will be removed and its cards restored for editing.`,
      )
    ) {
      return
    }

    setUndoError('')
    setIsUndoingRound(true)

    try {
      onLobbyChange(
        await undoLobbyRound(lobby.code, game.runId, session.token),
      )
    } catch (requestError) {
      setUndoError(toErrorMessage(requestError))
    } finally {
      setIsUndoingRound(false)
    }
  }

  const handleRestartGame = async () => {
    if (
      session?.role !== 'host' ||
      !isConnected ||
      isRestartingGame ||
      !window.confirm(
        'Restart this game? All scores, hands, and round history will be permanently cleared. Players will stay seated.',
      )
    ) {
      return
    }

    setRestartError('')
    setIsRestartingGame(true)

    try {
      onLobbyChange(
        await restartLobbyGame(lobby.code, game.runId, session.token),
      )
    } catch (requestError) {
      setRestartError(toErrorMessage(requestError))
    } finally {
      setIsRestartingGame(false)
    }
  }

  return (
    <div className="app-shell game-shell">
      <SiteHeader />
      <main className="game-main">
        <div className="game-heading">
          <div>
            <p className="kicker">Game {lobby.code}</p>
            <h1>
              {lobby.status === 'finished'
                ? 'Game complete'
                : `Round ${game.roundNumber}`}
            </h1>
          </div>
          <div className="heading-actions">
            {session?.role === 'host' && (
              <button
                className="restart-game-button"
                type="button"
                aria-label="Restart game"
                title="Restart game"
                disabled={!isConnected || isRestartingGame}
                onClick={handleRestartGame}
              >
                {isRestartingGame ? (
                  <LoaderCircle
                    className="button-spinner"
                    aria-hidden="true"
                  />
                ) : (
                  <RotateCcw aria-hidden="true" />
                )}
              </button>
            )}
            <Link
              className="display-launch-link"
              to={`/display/${lobby.code}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open room display"
              title="Open room display"
            >
              <MonitorUp aria-hidden="true" />
              <span>Display</span>
            </Link>
            <span
              className={`status-chip game-status ${lobby.status} connection-${connectionState}`}
            >
              <span aria-hidden="true" />
              {connectionLabel(
                connectionState,
                lobby.status === 'finished' ? 'Final' : 'In play',
              )}
            </span>
          </div>
        </div>

        <ConnectionBanner
          state={connectionState}
          message={connectionMessage}
        />
        {restartError && (
          <div className="restart-game-error">
            <FormError message={restartError} />
          </div>
        )}

        {lobby.status === 'finished' && (
          <section className="winner-banner" aria-labelledby="winner-title">
            <Trophy aria-hidden="true" />
            <div>
              <p className="eyebrow">
                {winnerNames.length === 1 ? 'Winner' : 'Winners'}
              </p>
              <h2 id="winner-title">{winnerNames.join(' & ')}</h2>
              <p>{standings[0]?.score ?? 0} points</p>
            </div>
          </section>
        )}

        <div
          className={`game-grid ${
            lobby.status === 'finished' ? 'game-grid-finished' : ''
          }`}
        >
          <section className="scoreboard-pane" aria-labelledby="standings-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">First to {game.targetScore}</p>
                <h2 id="standings-title">Standings</h2>
              </div>
              <Target aria-hidden="true" />
            </div>
            <ol className="scoreboard-list">
              {standings.map((player, index) => {
                const liveTotal = projectedScore(player)
                return (
                <li
                  className={`${player.hand.ready ? 'hand-ready' : ''} ${
                    player.hand.busted ? 'hand-busted' : ''
                  }`}
                  key={player.id}
                >
                  <span className="rank-number">{index + 1}</span>
                  <span className="standing-token">
                    <span
                      className={`player-token token-${index % 4}`}
                      aria-hidden="true"
                    >
                      {player.name.charAt(0).toUpperCase()}
                    </span>
                    {player.id === session?.playerId && <small>You</small>}
                  </span>
                  <div className="standing-player">
                    <span className="standing-name">
                      <span>{player.name}</span>
                    </span>
                    {lobby.status === 'active' && (
                      <HandChips hand={player.hand} />
                    )}
                    {lobby.status === 'active' && (
                      <span className="score-breakdown">
                        <span>
                          Banked <b>{player.score}</b>
                        </span>
                        <span>
                          This round <b>+{player.hand.points}</b>
                        </span>
                      </span>
                    )}
                    <span
                      className="score-track"
                      role="progressbar"
                      aria-label={`${player.name} score`}
                      aria-valuemin={0}
                      aria-valuemax={game.targetScore}
                      aria-valuenow={Math.min(liveTotal, game.targetScore)}
                    >
                      <span
                        style={{
                          width: `${Math.min(100, (liveTotal / game.targetScore) * 100)}%`,
                        }}
                      />
                    </span>
                  </div>
                  <div className="score-actions">
                    <span className="score-total">
                      <strong>{liveTotal}</strong>
                      <small>
                        {lobby.status === 'active' ? 'Projected' : 'Total'}
                      </small>
                      {lobby.status === 'active' && (
                        <small className="hand-state">
                          {player.hand.busted
                            ? 'Bust'
                            : player.hand.ready
                              ? 'Ready'
                              : 'Choosing'}
                        </small>
                      )}
                    </span>
                    {lobby.status === 'active' &&
                      session?.role === 'host' &&
                      player.role !== 'host' && (
                        <button
                          className="remove-player-button"
                          type="button"
                          aria-label={`Remove ${player.name} from game`}
                          title={`Remove ${player.name} from game`}
                          disabled={
                            !isConnected || removingPlayerId !== null
                          }
                          onClick={() =>
                            void onRemovePlayer(player.id, player.name)
                          }
                        >
                          {removingPlayerId === player.id ? (
                            <LoaderCircle
                              className="button-spinner"
                              aria-hidden="true"
                            />
                          ) : (
                            <UserMinus aria-hidden="true" />
                          )}
                        </button>
                      )}
                  </div>
                </li>
              )})}
            </ol>
            <FormError message={removeError} />
          </section>

          {lobby.status === 'active' && currentPlayer && draftHand ? (
            <div className="game-side-column">
              <HandEditor
                hand={draftHand}
                saveState={handSaveState}
                error={handError}
                disabled={!isConnected}
                onChange={persistHand}
              />
              <section className="round-control-pane" aria-live="polite">
                <div>
                  <p className="eyebrow">Round readiness</p>
                  <strong>
                    {readyCount} / {lobby.players.length} ready
                  </strong>
                </div>
                {session?.role === 'host' ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      !isConnected || !allHandsReady || isCompletingRound
                    }
                    onClick={handleRoundComplete}
                  >
                    <span>
                      {isCompletingRound ? 'Completing round' : 'Complete round'}
                    </span>
                    {isCompletingRound ? (
                      <LoaderCircle
                        className="button-spinner"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowRight aria-hidden="true" />
                    )}
                  </button>
                ) : (
                  <span className="host-will-complete">
                    Host completes the round
                  </span>
                )}
                <FormError message={roundError} />
              </section>
            </div>
          ) : lobby.status === 'active' ? (
            <section className="round-status-pane" aria-live="polite">
              <Target aria-hidden="true" />
              <div>
                <p className="eyebrow">Round {game.roundNumber}</p>
                <h2>Scores are being tallied</h2>
              </div>
            </section>
          ) : null}
        </div>

        {game.rounds.length > 0 && (
          <section className="history-pane" aria-labelledby="history-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Score log</p>
                <h2 id="history-title">Round history</h2>
              </div>
              <div className="history-heading-actions">
                <History aria-hidden="true" />
                {session?.role === 'host' && (
                  <button
                    className="undo-round-button"
                    type="button"
                    aria-label={`Undo round ${latestRound?.number ?? ''}`}
                    title={
                      currentRoundHasChanges
                        ? 'Undo is unavailable after the next round begins'
                        : 'Undo last round'
                    }
                    disabled={
                      !isConnected || !canUndoRound || isUndoingRound
                    }
                    onClick={handleUndoRound}
                  >
                    {isUndoingRound ? (
                      <LoaderCircle
                        className="button-spinner"
                        aria-hidden="true"
                      />
                    ) : (
                      <Undo2 aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            </div>
            <FormError message={undoError} />
            <ol className="round-history-list">
              {[...game.rounds].reverse().map((round) => (
                <li key={round.number}>
                  <strong>Round {round.number}</strong>
                  <div>
                    {round.scores.map((score) => (
                      <span className="history-score" key={score.playerId}>
                        <span>
                          <b>
                            {score.playerName ??
                              playersById.get(score.playerId)?.name}
                          </b>
                          <HandChips hand={score.hand} />
                        </span>
                        <small>
                          +{score.points} / {score.total} total
                        </small>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}

interface HandEditorProps {
  hand: PlayerRoundHand
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  error: string
  disabled: boolean
  onChange: (hand: HandSelection & { ready: boolean }) => void
}

function HandEditor({
  hand,
  saveState,
  error,
  disabled,
  onChange,
}: HandEditorProps) {
  const score = calculateHandScore(hand)
  const hasCard = hand.numberCards.length > 0 || hand.modifiers.length > 0
  const canMarkReady = hasCard || hand.busted

  const changeHand = (changes: Partial<HandSelection>) => {
    if (hand.ready) {
      return
    }

    onChange({
      numberCards: hand.numberCards,
      modifiers: hand.modifiers,
      busted: hand.busted,
      ...changes,
      ready: false,
    })
  }

  const toggleNumberCard = (card: number) => {
    const isSelected = hand.numberCards.includes(card)

    if (!isSelected && hand.numberCards.length === 7) {
      return
    }

    changeHand({
      numberCards: isSelected
        ? hand.numberCards.filter((numberCard) => numberCard !== card)
        : [...hand.numberCards, card].sort((left, right) => left - right),
    })
  }

  const toggleModifier = (modifier: ScoreModifier) => {
    const isSelected = hand.modifiers.includes(modifier)
    changeHand({
      modifiers: isSelected
        ? hand.modifiers.filter((scoreModifier) => scoreModifier !== modifier)
        : [...hand.modifiers, modifier],
    })
  }

  return (
    <section className="hand-entry-pane" aria-labelledby="hand-entry-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Your cards</p>
          <h2 id="hand-entry-title">Your hand</h2>
        </div>
        <span className={`hand-save-state ${saveState}`} aria-live="polite">
          {saveState === 'saving'
            ? 'Saving'
            : saveState === 'error'
              ? 'Not saved'
              : saveState === 'saved'
                ? 'Saved'
                : 'Live'}
        </span>
      </div>

      <div className={`hand-score-preview ${hand.busted ? 'busted' : ''}`}>
        <span>{hand.busted ? 'Bust score' : 'Round score'}</span>
        <strong>{score.points}</strong>
        {!hand.busted && (
          <small>
            {score.numberTotal}
            {score.hasMultiplier ? ' x 2' : ''}
            {score.modifierTotal > 0 ? ` + ${score.modifierTotal}` : ''}
            {score.hasFlip7 ? ' + 15' : ''}
          </small>
        )}
      </div>

      <fieldset className="card-selector">
        <legend>Number cards</legend>
        <div className="number-card-grid">
          {NUMBER_CARDS.map((card) => {
            const isSelected = hand.numberCards.includes(card)
            return (
              <button
                className={isSelected ? 'is-selected' : ''}
                type="button"
                key={card}
                aria-pressed={isSelected}
                disabled={
                  disabled ||
                  hand.ready ||
                  (!isSelected && hand.numberCards.length === 7)
                }
                onClick={() => toggleNumberCard(card)}
              >
                {card}
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="card-selector">
        <legend>Modifiers</legend>
        <div className="modifier-card-grid">
          {SCORE_MODIFIERS.map((modifier) => {
            const isSelected = hand.modifiers.includes(modifier)
            return (
              <button
                className={isSelected ? 'is-selected' : ''}
                type="button"
                key={modifier}
                aria-pressed={isSelected}
                disabled={disabled || hand.ready}
                onClick={() => toggleModifier(modifier)}
              >
                {SCORE_MODIFIER_LABELS[modifier]}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="bust-selector" role="group" aria-label="Hand result">
        <button
          className={!hand.busted ? 'is-selected' : ''}
          type="button"
          aria-pressed={!hand.busted}
          disabled={disabled || hand.ready}
          onClick={() => changeHand({ busted: false })}
        >
          Scoring
        </button>
        <button
          className={hand.busted ? 'is-busted' : ''}
          type="button"
          aria-pressed={hand.busted}
          disabled={disabled || hand.ready}
          onClick={() => changeHand({ busted: true })}
        >
          Busted
        </button>
      </div>

      <FormError message={error} />
      <button
        className={hand.ready ? 'secondary-button hand-ready-button' : 'primary-button hand-ready-button'}
        type="button"
        disabled={disabled || (!hand.ready && !canMarkReady)}
        onClick={() =>
          onChange({
            numberCards: hand.numberCards,
            modifiers: hand.modifiers,
            busted: hand.busted,
            ready: !hand.ready,
          })
        }
      >
        <span>{hand.ready ? 'Edit hand' : 'Hand ready'}</span>
        {hand.ready ? (
          <RotateCcw aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
      </button>
    </section>
  )
}

function HandChips({ hand }: { hand: HandSelection & { hasFlip7?: boolean } }) {
  if (hand.numberCards.length === 0 && hand.modifiers.length === 0) {
    return (
      <span className={`live-hand-chips ${hand.busted ? 'busted-hand' : 'empty-hand'}`}>
        {hand.busted ? 'Bust - 0 points' : 'No cards yet'}
      </span>
    )
  }

  return (
    <span className="live-hand-chips">
      {hand.numberCards.map((card) => (
        <span className="mini-number-card" key={card}>
          {card}
        </span>
      ))}
      {hand.modifiers.map((modifier) => (
        <span className="mini-modifier-card" key={modifier}>
          {SCORE_MODIFIER_LABELS[modifier]}
        </span>
      ))}
      {hand.busted ? (
        <span className="bust-chip">Bust - 0</span>
      ) : (hand.hasFlip7 ?? hand.numberCards.length === 7) ? (
        <span className="flip-seven-chip">Flip 7 +15</span>
      ) : null}
    </span>
  )
}

interface FieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoComplete: string
  maxLength: number
  autoFocus?: boolean
  inputMode?: 'text'
  code?: boolean
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  maxLength,
  autoFocus,
  inputMode,
  code = false,
}: FieldProps) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        className={code ? 'code-input' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        maxLength={maxLength}
        autoFocus={autoFocus}
        inputMode={inputMode}
        required
      />
    </label>
  )
}

interface SubmitButtonProps {
  label: string
  busyLabel: string
  isSubmitting: boolean
  disabled: boolean
}

function SubmitButton({
  label,
  busyLabel,
  isSubmitting,
  disabled,
}: SubmitButtonProps) {
  return (
    <button
      className="primary-button"
      type="submit"
      disabled={disabled || isSubmitting}
    >
      <span>{isSubmitting ? busyLabel : label}</span>
      {isSubmitting ? (
        <LoaderCircle className="button-spinner" aria-hidden="true" />
      ) : (
        <ArrowRight aria-hidden="true" />
      )}
    </button>
  )
}

function FormError({ message }: { message: string }) {
  return (
    <p className="form-error" role="alert" aria-live="polite">
      {message}
    </p>
  )
}

function ConnectionBanner({
  state,
  message,
}: {
  state: ConnectionState
  message: string
}) {
  if (state === 'live' || state === 'connecting') {
    return null
  }

  const isUnavailable = state === 'unavailable'

  return (
    <section
      className={`connection-banner ${state}`}
      role={isUnavailable ? 'alert' : 'status'}
      aria-live="polite"
    >
      <CloudOff aria-hidden="true" />
      <div>
        <strong>
          {isUnavailable ? 'Lobby unavailable' : 'Trying to reconnect'}
        </strong>
        <span>
          {message ||
            (isUnavailable
              ? 'This game may no longer be available.'
              : 'Game actions will return when the connection is restored.')}
        </span>
      </div>
    </section>
  )
}

function connectionLabel(
  state: ConnectionState,
  connectedLabel: string,
): string {
  if (state === 'live') {
    return connectedLabel
  }

  if (state === 'unavailable') {
    return 'Unavailable'
  }

  return state === 'connecting' ? 'Connecting' : 'Reconnecting'
}

function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Flip Seven home">
        <span className="brand-card">7</span>
        <span>Flip Seven</span>
      </Link>
      <div className="site-header-actions">
        <span className="edition-label">Scorekeeper</span>
        <RulesLink />
      </div>
    </header>
  )
}

function RulesLink() {
  return (
    <a
      className="rules-link"
      href={RULES_PDF_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open Flip 7 rules PDF"
      title="Flip 7 rules"
    >
      <BookOpen aria-hidden="true" />
      <span>Rules</span>
    </a>
  )
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>Unofficial game companion</span>
      <span>Made for the table</span>
    </footer>
  )
}

function normalizeCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '')
    .slice(0, 5)
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.'
}

export default App