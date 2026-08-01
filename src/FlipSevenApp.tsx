import { type FormEvent, startTransition, useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Crown,
  House,
  LoaderCircle,
  Share2,
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
import type { LobbyView } from '../shared/contracts'
import cardFan from './assets/card-fan.svg'
import { createLobby, getLobby, joinLobby, removeLobbyPlayer } from './lib/api'
import { getLobbySession, saveLobbySession } from './lib/session'
import './flip-seven.css'

type HomeMode = 'create' | 'join'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/lobby/:code" element={<LobbyPage />} />
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
          ) : (
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
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

function JoinPage() {
  const navigate = useNavigate()
  const { code: routeCode = '' } = useParams()
  const code = normalizeCodeInput(routeCode)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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
          <form className="lobby-form" onSubmit={handleSubmit}>
            <h1 id="join-title">Pick your table name</h1>
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
          </form>
        </section>
      </main>
      <SiteFooter />
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
  const [removeError, setRemoveError] = useState('')
  const [removingPlayerId, setRemovingPlayerId] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    let hasLoaded = false

    const refreshLobby = async () => {
      try {
        const nextLobby = await getLobby(code)

        if (!isCurrent) {
          return
        }

        if (hasLoaded) {
          startTransition(() => setLobby(nextLobby))
        } else {
          setLobby(nextLobby)
          hasLoaded = true
        }
        setError('')
      } catch (requestError) {
        if (isCurrent) {
          setError(toErrorMessage(requestError))
        }
      }
    }

    void refreshLobby()
    const interval = window.setInterval(() => void refreshLobby(), 3_000)

    return () => {
      isCurrent = false
      window.clearInterval(interval)
    }
  }, [code, refreshVersion])

  const inviteUrl = `${window.location.origin}/join/${code}`
  const session = getLobbySession(code)

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
    if (
      session?.role !== 'host' ||
      removingPlayerId ||
      !window.confirm(`Remove ${playerName} from this lobby?`)
    ) {
      return
    }

    setRemoveError('')
    setRemovingPlayerId(playerId)

    try {
      const nextLobby = await removeLobbyPlayer(
        code,
        playerId,
        session.token,
      )
      setLobby(nextLobby)
    } catch (requestError) {
      setRemoveError(toErrorMessage(requestError))
    } finally {
      setRemovingPlayerId(null)
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
          <h1>You were removed from this lobby.</h1>
          <div className="state-actions">
            <Link className="primary-button compact-button" to={`/join/${code}`}>
              Join again
            </Link>
            <Link className="secondary-button compact-button" to="/">
              <House aria-hidden="true" />
              Home
            </Link>
          </div>
        </main>
      </div>
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
          <span className="status-chip">
            <span aria-hidden="true" />
            Live
          </span>
        </div>

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
                      disabled={removingPlayerId !== null}
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
            <FormError message={removeError} />
            <p className="waiting-note" aria-live="polite">
              <span aria-hidden="true" />
              Waiting for players
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
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

function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Flip Seven home">
        <span className="brand-card">7</span>
        <span>Flip Seven</span>
      </Link>
      <span className="edition-label">Scorekeeper</span>
    </header>
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