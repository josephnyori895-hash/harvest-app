import { useEffect, useRef, useState } from 'react'
import { getSocket, onSocket, emitSocket, getIceServers } from '../lib/realtime'

export default function CallScreen({ peer, type, onEnd }: { peer: string; type: 'voice' | 'video'; onEnd: () => void }) {
  const [status, setStatus] = useState('Calling...')
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const localRef = useRef<HTMLVideoElement>(null)
  const remoteRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const hasOffered = useRef(false)

  // WebRTC via VPS coturn 3478/5349 — mandatory for 60% Nyeri 3G symmetric NAT
  useEffect(() => {
    const pc = new RTCPeerConnection(getIceServers())
    pcRef.current = pc
    let local: MediaStream | null = null

    const setupMedia = async () => {
      try {
        local = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' })
        localStreamRef.current = local
        if (localRef.current) localRef.current.srcObject = local
        local.getTracks().forEach(t => pc.addTrack(t, local!))
      } catch (e: any) {
        console.warn('[webrtc] getUserMedia failed', e.message)
        setStatus('Mic/cam blocked — check permissions')
        // still proceed for signaling without tracks (recvonly fallback)
      }
    }

    pc.ontrack = (ev) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = ev.streams[0]
      setStatus('Connected')
    }
    pc.onicecandidate = (ev) => {
      if (ev.candidate) emitSocket('call:ice', { to: peer, candidate: ev.candidate })
    }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') setStatus('Connected')
      else if (s === 'failed') { setStatus('Reconnecting…'); try{ pc.restartIce(); const offer = pc.createOffer({iceRestart:true}); offer.then(o=> pc.setLocalDescription(o).then(()=> emitSocket('call:offer', { to: peer, sdp: o, type })))}catch{} }
      else if (s === 'disconnected') setStatus('Reconnecting…')
      else if (s === 'closed') setStatus('Ended')
    }
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') { setStatus('ICE failed — retrying TURN'); try{ pc.restartIce() }catch{} }
    }

    setupMedia().then(async () => {
      // caller creates offer
      if (!hasOffered.current) {
        hasOffered.current = true
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: type === 'video' })
        await pc.setLocalDescription(offer)
        emitSocket('call:offer', { to: peer, sdp: offer, type })
        setStatus('Ringing…')
        // fallback timeout: if no answer in 20s, show no-answer
        setTimeout(() => setStatus(prev => prev === 'Ringing…' ? 'No answer' : prev), 20000)
      }
    })

    // signaling listeners
    const offAnswer = onSocket('call:answer', async ({ from, sdp }: any) => {
      if (from !== peer) return
      if (pc.signalingState !== 'have-local-offer') return
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      setStatus('Connected')
    })
    const offOffer = onSocket('call:offer', async ({ from, sdp, type: offerType }: any) => {
      if (from !== peer) return
      // incoming call: if we're caller and already offered, ignore duplicate
      if (pc.signalingState !== 'stable') return
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      emitSocket('call:answer', { to: from, sdp: answer })
      setStatus('Connected')
    })
    const offIce = onSocket('call:ice', async ({ from, candidate }: any) => {
      if (from !== peer || !candidate) return
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch {}
    })
    const offEnd = onSocket('call:end', ({ from }: any) => {
      if (from === peer) { setStatus('Ended'); setTimeout(onEnd, 800) }
    })
    const offDecline = onSocket('call:decline', ({ from }: any) => {
      if (from === peer) { setStatus('Declined'); setTimeout(onEnd, 800) }
    })

    return () => {
      offAnswer(); offOffer(); offIce(); offEnd(); offDecline()
      pc.getSenders().forEach(s => { try { s.track?.stop() } catch {} })
      local?.getTracks().forEach(t => t.stop())
      pc.close()
    }
  }, [peer, type, onEnd])

  const toggleMute = () => {
    const next = !muted
    localStreamRef.current?.getAudioTracks().forEach(t => (t.enabled = !next))
    setMuted(next)
  }
  const toggleCam = () => {
    const next = !camOff
    localStreamRef.current?.getVideoTracks().forEach(t => (t.enabled = !next))
    setCamOff(next)
  }
  const handleEnd = () => {
    emitSocket('call:end', { to: peer })
    try { pcRef.current?.close() } catch {}
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    onEnd()
  }

  return (
    <div className="fixed inset-0 bg-zinc-900 z-50 flex flex-col">
      <div className="flex-1 relative bg-black flex flex-col items-center justify-center overflow-hidden">
        <div className="absolute top-4 left-4 flex items-center gap-2 text-white">
          <span className="text-xs bg-white/20 px-2 py-1 rounded-full">{type === 'video' ? '📹 Video' : '📞 Voice'} • {status}</span>
        </div>
        {/* remote video full-bleed */}
        <video ref={remoteVideoRef} autoPlay playsInline className={`absolute inset-0 w-full h-full object-cover ${type === 'video' ? 'block' : 'hidden'}`} />
        {/* fallback avatar when no remote */}
        <div className={`w-24 h-24 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 flex items-center justify-center text-2xl mb-4 ${status === 'Connected' && type === 'video' ? 'hidden' : 'flex'}`}>{peer[0].toUpperCase()}</div>
        <p className="text-white font-semibold z-10">{peer}</p>
        <p className="text-zinc-400 text-sm z-10">{status}</p>
        {type === 'video' && (
          <video ref={localRef} autoPlay playsInline muted className={`mt-6 w-32 h-24 bg-zinc-800 rounded-xl border-2 border-white object-cover ${camOff ? 'hidden' : 'block'}`} />
        )}
        {type === 'video' && camOff && <div className="mt-6 w-32 h-24 bg-zinc-800 rounded-xl border-2 border-white flex items-center justify-center text-xs text-white">Camera off</div>}
      </div>
      <div className="p-6 bg-black flex justify-center gap-6">
        <button onClick={toggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center ${muted ? 'bg-white text-black' : 'bg-zinc-800 text-white'}`}>{muted ? '🔇' : '🎤'}</button>
        <button onClick={handleEnd} className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center text-white text-xl">✕</button>
        <button onClick={toggleCam} className={`w-12 h-12 rounded-full flex items-center justify-center ${camOff ? 'bg-white text-black' : 'bg-zinc-800 text-white'}`}>📹</button>
      </div>
    </div>
  )
}
