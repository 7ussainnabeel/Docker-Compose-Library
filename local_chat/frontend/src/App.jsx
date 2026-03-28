import { useEffect, useMemo, useRef, useState } from 'react';
import { decryptBytes, decryptJson, encryptBytes, encryptJson } from './lib/crypto';
import {
  deleteMessageById,
  deleteMessagesByConversation,
  loadMessageById,
  loadMessagesByConversation,
  loadSetting,
  saveMessage,
  saveSetting
} from './lib/localDb';
import { WsClient } from './lib/wsClient';

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for mobile/non-secure contexts where randomUUID is unavailable.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function loadLocalProfile() {
  const MAX_AVATAR_DATA_URL_LENGTH = 120000;
  const saved = localStorage.getItem('lan-profile');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (typeof parsed?.avatar === 'string' && parsed.avatar.length > MAX_AVATAR_DATA_URL_LENGTH) {
        parsed.avatar = '';
        localStorage.setItem('lan-profile', JSON.stringify(parsed));
      }
      if (!parsed.about || typeof parsed.about !== 'string') {
        parsed.about = 'Hey there! I am using LAN Messenger.';
        localStorage.setItem('lan-profile', JSON.stringify(parsed));
      }
      return parsed;
    } catch {
      // ignore bad local profile
    }
  }

  const fallback = {
    userId: randomId(),
    username: `User-${Math.floor(Math.random() * 9999)}`,
    avatar: '',
    about: 'Hey there! I am using LAN Messenger.'
  };

  localStorage.setItem('lan-profile', JSON.stringify(fallback));
  return fallback;
}

function dmConversationId(me, peer) {
  return [me, peer].sort().join(':');
}

function convKey(active, meId) {
  if (!active) return null;
  if (active.type === 'direct') return `dm:${dmConversationId(meId, active.id)}`;
  return `group:${active.id}`;
}

function fmtTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function Avatar({ name, avatar, className = 'profile-image' }) {
  if (avatar) {
    return <img className={`${className} profile-photo`} src={avatar} alt={name || 'Profile'} />;
  }

  return <span className={`${className} profile-fallback`}>{initials(name)}</span>;
}

function PinPad({ onDigit, onBackspace, onClear }) {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="auth-pinpad" role="group" aria-label="PIN number pad">
      {digits.map((digit) => (
        <button key={digit} type="button" className="auth-pinpad-key" onClick={() => onDigit(digit)}>{digit}</button>
      ))}
      <button type="button" className="auth-pinpad-key is-muted" onClick={onClear}>Clear</button>
      <button type="button" className="auth-pinpad-key" onClick={() => onDigit('0')}>0</button>
      <button type="button" className="auth-pinpad-key is-muted" onClick={onBackspace}>Del</button>
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('file-read-failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-load-failed'));
    img.src = src;
  });
}

async function compressAvatarToDataUrl(file) {
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);

  const maxDim = 256;
  const ratio = Math.min(maxDim / image.width, maxDim / image.height, 1);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(image, 0, 0, width, height);

  let quality = 0.85;
  let out = canvas.toDataURL('image/jpeg', quality);
  while (out.length > 120000 && quality > 0.35) {
    quality -= 0.1;
    out = canvas.toDataURL('image/jpeg', quality);
  }

  return out;
}

async function compressPhotoToDataUrl(file) {
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);

  const maxDim = 1280;
  const ratio = Math.min(maxDim / image.width, maxDim / image.height, 1);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(image, 0, 0, width, height);

  const maxLength = 120000;
  let quality = 0.82;
  let out = canvas.toDataURL('image/jpeg', quality);
  while (out.length > maxLength && quality > 0.3) {
    quality -= 0.08;
    out = canvas.toDataURL('image/jpeg', quality);
  }

  return out;
}

function statusWeight(status) {
  const rank = {
    sending: 0,
    sent: 1,
    delivered: 2,
    read: 3
  };

  return rank[status || 'sending'] || 0;
}

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const QUICK_EMOJIS = ['😀', '😂', '😍', '😊', '😉', '👍', '🙏', '❤️', '🔥', '🎉', '😎', '🤔', '😢', '😡', '💯', '✅', '👀', '🤝', '🙌', '🤖'];

  const [profile, setProfile] = useState(loadLocalProfile());
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [aesSecret, setAesSecret] = useState('lan-local-key');
  const [isConnected, setIsConnected] = useState(false);
  const [theme, setTheme] = useState(getSystemTheme());
  const [typing, setTyping] = useState({});
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [isMessageOpen, setIsMessageOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth <= 767 : false);
  const [callState, setCallState] = useState({ status: 'idle', peerId: null, peerIds: [], mode: 'webrtc', groupId: null, conference: false });
  const [infoPanelMode, setInfoPanelMode] = useState('self');
  const [onboardingName, setOnboardingName] = useState('');
  const [onboardingAbout, setOnboardingAbout] = useState('Hey there! I am using LAN Messenger.');
  const [onboardingPin, setOnboardingPin] = useState('');
  const [authScreenOpen, setAuthScreenOpen] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [loginPin, setLoginPin] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showDirectory, setShowDirectory] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [chatRowMenuOpen, setChatRowMenuOpen] = useState('');
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [archivedConversations, setArchivedConversations] = useState({});
  const [mutedConversations, setMutedConversations] = useState({});
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [recentConversations, setRecentConversations] = useState([]);
  const [tempChatSettings, setTempChatSettings] = useState({});
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [aboutDraft, setAboutDraft] = useState(profile.about || 'Hey there! I am using LAN Messenger.');
  const [nameDraft, setNameDraft] = useState(profile.username || '');
  const [newPinDraft, setNewPinDraft] = useState('');
  const [newPinConfirmDraft, setNewPinConfirmDraft] = useState('');
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceWaveform, setVoiceWaveform] = useState([]);
  const [voiceDraft, setVoiceDraft] = useState({ blob: null, url: '', mimeType: 'audio/webm' });
  const [profilePin, setProfilePin] = useState('');
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupSelectedMembers, setGroupSelectedMembers] = useState([]);
  const [groupInfo, setGroupInfo] = useState({ group: null, members: [] });
  const [groupCallStatus, setGroupCallStatus] = useState({});
  const [groupNameEditDraft, setGroupNameEditDraft] = useState('');
  const [groupMembersToAdd, setGroupMembersToAdd] = useState([]);
  const [onboardingPinConfirm, setOnboardingPinConfirm] = useState('');
  const [signupPinField, setSignupPinField] = useState('create');

  const wsRef = useRef(null);
  const profileRef = useRef(profile);
  const callStateRef = useRef(callState);
  const profilePinRef = useRef(profilePin);
  const authReadyRef = useRef(false);
  const authModeRef = useRef('login');
  const aesSecretRef = useRef(aesSecret);
  const activeConversationRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const localVoiceChunksRef = useRef([]);
  const incomingVoiceRef = useRef(new Map());
  const typingTimers = useRef(new Map());
  const profilePhotoInputRef = useRef(null);
  const readReceiptSentRef = useRef(new Set());

  const peerConnRef = useRef(null);
  const peerConnsRef = useRef(new Map());
  const localCallStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pendingIceRef = useRef(new Map());
  const remoteAudioElsRef = useRef(new Map());
  const autoJoinGroupIdRef = useRef(null);
  const voiceRecordingRef = useRef({ startedAt: 0, clipId: null });
  const chatMenuRef = useRef(null);
  const sideMenuRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const photoInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const attachmentMenuRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const waveformRafRef = useRef(0);
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const waveformPaintAtRef = useRef(0);

  const activeConversationKey = convKey(active, profile.userId);
  const visibleUsers = useMemo(() => users.filter((u) => u.id !== profile.userId), [users, profile.userId]);
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const activeGroup = useMemo(
    () => (active?.type === 'group' ? groups.find((g) => g.id === active.id) || null : null),
    [active, groups]
  );

  const activeGroupInfo = useMemo(() => {
    if (!activeGroup || groupInfo.group?.id !== activeGroup.id) return null;
    return groupInfo;
  }, [activeGroup, groupInfo]);

  const activeGroupMembers = activeGroupInfo?.members || [];
  const activeGroupCall = active?.type === 'group' ? groupCallStatus[active.id] : null;
  const myActiveGroupMember = activeGroupMembers.find((member) => member.id === profile.userId) || null;
  const isActiveGroupCreator = activeGroupInfo?.group?.created_by === profile.userId;
  const isActiveGroupAdmin = Boolean(isActiveGroupCreator || myActiveGroupMember?.role === 'admin');
  const activeDirectUser = active?.type === 'direct' ? userById.get(active.id) || null : null;
  const canEditOwnProfile = infoPanelMode === 'self';
  const addableActiveGroupUsers = useMemo(() => {
    if (!activeGroupInfo) return [];
    const memberIds = new Set(activeGroupMembers.map((member) => member.id));
    return visibleUsers.filter((user) => !memberIds.has(user.id));
  }, [activeGroupInfo, activeGroupMembers, visibleUsers]);

  const combinedChats = useMemo(() => {
    const direct = visibleUsers.map((u) => ({
      type: 'direct',
      id: u.id,
      label: u.username,
      online: Boolean(u.online)
    }));
    const grouped = groups.map((g) => ({
      type: 'group',
      id: g.id,
      label: g.name,
      online: true
    }));

    const q = search.trim().toLowerCase();
    const all = [...direct, ...grouped];
    const filtered = q ? all.filter((c) => c.label.toLowerCase().includes(q)) : all;
    const filteredByArchive = filtered.filter((c) => {
      const conversationId = convKey(c, profile.userId);
      const isArchived = Boolean(archivedConversations[conversationId]);
      return showArchivedChats ? isArchived : !isArchived;
    });

    if (showDirectory) {
      return filtered;
    }

    const recentSet = new Set(recentConversations);
    const recentFirst = filteredByArchive.filter((c) => recentSet.has(convKey(c, profile.userId)));
    const remaining = filteredByArchive.filter((c) => !recentSet.has(convKey(c, profile.userId)));
    const prioritized = [...recentFirst, ...remaining];
    if (active && !prioritized.find((c) => c.id === active.id && c.type === active.type)) {
      const activeConversationId = convKey(active, profile.userId);
      const activeArchived = Boolean(archivedConversations[activeConversationId]);
      if ((showArchivedChats && activeArchived) || (!showArchivedChats && !activeArchived)) {
        prioritized.unshift(active);
      }
    }
    return prioritized;
  }, [visibleUsers, groups, search, showDirectory, recentConversations, active, profile.userId, archivedConversations, showArchivedChats]);

  const onlineDirectoryUsers = useMemo(
    () => visibleUsers.filter((u) => Boolean(u.online)).sort((a, b) => a.username.localeCompare(b.username)),
    [visibleUsers]
  );

  const offlineDirectoryUsers = useMemo(
    () => visibleUsers.filter((u) => !u.online).sort((a, b) => a.username.localeCompare(b.username)),
    [visibleUsers]
  );

  const visibleMessages = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => (m.text || '').toLowerCase().includes(q));
  }, [messages, chatSearchQuery]);

  const activeTempSetting = activeConversationKey ? tempChatSettings[activeConversationKey] : null;

  useEffect(() => {
    profileRef.current = profile;
    localStorage.setItem('lan-profile', JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    setAboutDraft(profile.about || 'Hey there! I am using LAN Messenger.');
  }, [profile.about]);

  useEffect(() => {
    setNameDraft(profile.username || '');
  }, [profile.username]);

  useEffect(() => {
    return () => {
      if (voiceDraft.url) {
        URL.revokeObjectURL(voiceDraft.url);
      }
    };
  }, [voiceDraft.url]);

  const markConversationRecent = (conversationId) => {
    setRecentConversations((prev) => {
      const next = [conversationId, ...prev.filter((id) => id !== conversationId)].slice(0, 100);
      void saveSetting('recentConversations', next);
      return next;
    });
  };

  const incrementUnread = (conversationId) => {
    setUnreadCounts((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] || 0) + 1
    }));
  };

  const clearUnread = (conversationId) => {
    setUnreadCounts((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  };

  useEffect(() => {
    aesSecretRef.current = aesSecret;
  }, [aesSecret]);

  useEffect(() => {
    profilePinRef.current = profilePin;
  }, [profilePin]);

  useEffect(() => {
    authModeRef.current = authMode;
  }, [authMode]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth <= 767;
      setIsMobile(mobile);
      if (!mobile) {
        setIsMessageOpen(false);
      }
    };

    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const updateVh = () => {
      const vh = (window.visualViewport?.height || window.innerHeight) * 0.01;
      document.documentElement.style.setProperty('--app-vh', `${vh}px`);
    };

    updateVh();
    window.addEventListener('resize', updateVh);
    window.visualViewport?.addEventListener('resize', updateVh);

    return () => {
      window.removeEventListener('resize', updateVh);
      window.visualViewport?.removeEventListener('resize', updateVh);
    };
  }, []);

  useEffect(() => {
    const onDocClick = (event) => {
      if (!chatMenuRef.current) return;
      if (!chatMenuRef.current.contains(event.target)) {
        setChatMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, []);

  useEffect(() => {
    const onDocClick = (event) => {
      if (sideMenuRef.current && !sideMenuRef.current.contains(event.target)) {
        setSideMenuOpen(false);
      }
      if (!event.target.closest('.chat-row-actions')) {
        setChatRowMenuOpen('');
      }
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, []);

  useEffect(() => {
    const onDocClick = (event) => {
      if (!emojiPickerRef.current) return;
      if (!emojiPickerRef.current.contains(event.target)) {
        setEmojiPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, []);

  useEffect(() => {
    const onDocClick = (event) => {
      if (!attachmentMenuRef.current) return;
      if (!attachmentMenuRef.current.contains(event.target)) {
        setAttachmentMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    return undefined;
  }, []);

  useEffect(() => {
    const boot = async () => {
      const savedSecret = await loadSetting('aesSecret');
      const savedRecent = await loadSetting('recentConversations');
      const savedTemp = await loadSetting('tempChatSettings');
      const savedPin = await loadSetting('profilePin');
      const savedArchived = await loadSetting('archivedConversations');
      const savedMuted = await loadSetting('mutedConversations');

      if (savedSecret) {
        setAesSecret(savedSecret);
      }

      setOnboardingName(profile.username);
      setOnboardingAbout(profile.about || 'Hey there! I am using LAN Messenger.');
      setOnboardingPin(typeof savedPin === 'string' ? savedPin : '');
      setLoginPin(typeof savedPin === 'string' ? savedPin : '');
      setProfilePin(typeof savedPin === 'string' ? savedPin : '');
      setAuthScreenOpen(true);
      setAuthMode('login');
      authReadyRef.current = false;
      if (Array.isArray(savedRecent)) setRecentConversations(savedRecent);
      if (savedTemp && typeof savedTemp === 'object') setTempChatSettings(savedTemp);
      if (savedArchived && typeof savedArchived === 'object') setArchivedConversations(savedArchived);
      if (savedMuted && typeof savedMuted === 'object') setMutedConversations(savedMuted);
    };

    void boot();
  }, [profile.username]);

  useEffect(() => {
    if (!activeConversationKey) {
      setMessages([]);
      return;
    }

    void loadMessagesByConversation(activeConversationKey).then((rows) => {
      const now = Date.now();
      const valid = rows.filter((m) => !(m.expiresAt && m.expiresAt <= now));
      const expired = rows.filter((m) => m.expiresAt && m.expiresAt <= now);
      expired.forEach((m) => {
        void deleteMessageById(m.id);
      });
      setMessages(valid.sort((a, b) => a.createdAt - b.createdAt));
    });
  }, [activeConversationKey]);

  useEffect(() => {
    activeConversationRef.current = activeConversationKey;
  }, [activeConversationKey]);

  useEffect(() => {
    if (!activeGroup) {
      setGroupInfo({ group: null, members: [] });
      setGroupNameEditDraft('');
      setGroupMembersToAdd([]);
      return;
    }
    wsRef.current?.send('group-meta-request', { groupId: activeGroup.id });
  }, [activeGroup]);

  useEffect(() => {
    if (showInfoPanel && activeGroup) {
      wsRef.current?.send('group-meta-request', { groupId: activeGroup.id });
    }
  }, [showInfoPanel, activeGroup]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    if (!activeGroupInfo?.group?.name) {
      setGroupNameEditDraft('');
      return;
    }
    setGroupNameEditDraft(activeGroupInfo.group.name);
  }, [activeGroupInfo?.group?.name]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setMessages((prev) => {
        const expired = prev.filter((m) => m.expiresAt && m.expiresAt <= now);
        expired.forEach((m) => {
          void deleteMessageById(m.id);
        });
        return prev.filter((m) => !(m.expiresAt && m.expiresAt <= now));
      });
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  const appendMessage = async (message) => {
    await saveMessage(message);
    if (message.conversationId === activeConversationKey) {
      setMessages((prev) => [...prev, message]);
    }
  };

  const sendHello = (profilePayload, { profileUpdate = false, authMode: mode = 'login' } = {}) => {
    wsRef.current?.send('hello', {
      ...profilePayload,
      pin: profilePinRef.current,
      authMode: mode,
      profileUpdate
    });
  };

  const openNewUserSetup = () => {
    setAuthMode('signup');
    authModeRef.current = 'new';
    setOnboardingPin('');
    setOnboardingPinConfirm('');
    setSignupPinField('create');
    setAuthScreenOpen(true);
  };

  const submitOldUserLogin = async () => {
    const cleanedPin = loginPin.trim();
    if (!/^(\d{4}|\d{6})$/.test(cleanedPin)) {
      window.alert('Enter a valid 4-digit or 6-digit PIN.');
      return;
    }

    setProfilePin(cleanedPin);
    profilePinRef.current = cleanedPin;
    authReadyRef.current = true;
    setAuthMode('login');
    authModeRef.current = 'login';
    setAuthScreenOpen(false);
    await saveSetting('profilePin', cleanedPin);

    if (wsRef.current?.ws && wsRef.current.ws.readyState === WebSocket.OPEN) {
      sendHello(profileRef.current, { profileUpdate: false, authMode: 'login' });
    } else {
      wsRef.current?.reconnectNow?.();
    }
  };

  const updateMessageStatus = (id, nextStatus) => {
    setMessages((prev) => {
      const updated = prev.map((m) => {
        if (m.id !== id || !m.mine) return m;
        const currentRank = statusWeight(m.status);
        const nextRank = statusWeight(nextStatus);
        if (nextRank <= currentRank) return m;
        const newer = { ...m, status: nextStatus };
        void saveMessage(newer);
        return newer;
      });
      return updated;
    });
  };

  const setTypingSignal = (conversation, fromUserId, on) => {
    setTyping((prev) => {
      const current = new Set(prev[conversation] || []);
      if (on) current.add(fromUserId);
      if (!on) current.delete(fromUserId);
      return { ...prev, [conversation]: Array.from(current) };
    });
  };

  const destroyCall = () => {
    if (peerConnRef.current) {
      peerConnRef.current.close();
      peerConnRef.current = null;
    }
    peerConnsRef.current.forEach((pc) => {
      pc.close();
    });
    peerConnsRef.current.clear();
    pendingIceRef.current.clear();
    remoteAudioElsRef.current.forEach((audio) => {
      audio.srcObject = null;
      audio.remove();
    });
    remoteAudioElsRef.current.clear();

    if (localCallStreamRef.current) {
      localCallStreamRef.current.getTracks().forEach((t) => t.stop());
      localCallStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.volume = 1;
    }

    setIsMuted(false);
    setIsSpeakerOn(true);
    setCallState({ status: 'idle', peerId: null, peerIds: [], mode: 'webrtc', groupId: null, conference: false });
  };

  const closePeerConnection = (peerId) => {
    const pc = peerConnsRef.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnsRef.current.delete(peerId);
    }
    pendingIceRef.current.delete(peerId);
    const remoteAudio = remoteAudioElsRef.current.get(peerId);
    if (remoteAudio) {
      remoteAudio.srcObject = null;
      remoteAudio.remove();
      remoteAudioElsRef.current.delete(peerId);
    }
  };

  const attachRemoteStream = (peerId, stream) => {
    if (!stream) return;

    if (peerConnsRef.current.size <= 1 && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.play().catch(() => {});
      return;
    }

    let audio = remoteAudioElsRef.current.get(peerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.style.display = 'none';
      document.body.appendChild(audio);
      remoteAudioElsRef.current.set(peerId, audio);
    }
    audio.srcObject = stream;
    audio.play().catch(() => {});
  };

  const createPeerConnection = (peerId, groupId = null) => {
    const existing = peerConnsRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: [] });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        wsRef.current?.send('call-ice', { to: peerId, candidate: event.candidate, groupId });
      }
    };

    pc.ontrack = (event) => {
      attachRemoteStream(peerId, event.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setCallState((prev) => ({
          ...prev,
          status: 'connected',
          peerId,
          peerIds: Array.from(new Set([...prev.peerIds, peerId]))
        }));
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        wsRef.current?.send('call-fallback', { to: peerId, reason: pc.connectionState, groupId });
        closePeerConnection(peerId);
        const remainingPeers = Array.from(peerConnsRef.current.keys());
        if (!remainingPeers.length) {
          setCallState({ status: 'fallback', peerId, peerIds: [], mode: 'ws-audio', groupId: null, conference: false });
          return;
        }
        setCallState((prev) => ({
          ...prev,
          status: 'fallback',
          peerId: remainingPeers[0],
          peerIds: remainingPeers,
          mode: 'ws-audio'
        }));
      }
    };

    peerConnRef.current = pc;
    peerConnsRef.current.set(peerId, pc);
    return pc;
  };

  useEffect(() => {
    const ws = new WsClient({
      onOpen: () => {
        setIsConnected(true);
        if (!authReadyRef.current || !profilePinRef.current) {
          setAuthScreenOpen(true);
          setAuthMode('login');
          return;
        }
        ws.send('hello', {
          ...profileRef.current,
          pin: profilePinRef.current,
          authMode: authModeRef.current,
          profileUpdate: false
        });
      },
      onClose: () => {
        setIsConnected(false);
      },
      onMessage: async (data) => {
        if (data.action === 'error') {
          if (data.code === 'invalid-pin') {
            window.alert('Invalid PIN. Please use 4 digits or 6 digits.');
            if (authScreenOpen) {
              authReadyRef.current = false;
              setAuthScreenOpen(true);
              setAuthMode('login');
            }
          }
          if (data.code === 'pin-not-found') {
            window.alert('No account found with this PIN. Choose Signup or use the correct PIN.');
            if (authScreenOpen) {
              authReadyRef.current = false;
              setAuthScreenOpen(true);
              setAuthMode('login');
            }
          }
          if (data.code === 'pin-in-use') {
            window.alert('This PIN is already used by another account. Choose a different PIN.');
            if (authScreenOpen) {
              authReadyRef.current = false;
              setAuthScreenOpen(true);
              setAuthMode('signup');
            }
          }
          if (data.code === 'forbidden-group-access') {
            window.alert('You do not have access to this group chat.');
          }
          if (data.code === 'forbidden-group-admin') {
            window.alert('Only group admins can add or remove members.');
          }
          if (data.code === 'forbidden-group-owner') {
            window.alert('Only the group creator can change member roles.');
          }
          if (data.code === 'cannot-remove-group-creator') {
            window.alert('The group creator cannot be removed from the group.');
          }
          if (data.code === 'cannot-change-group-creator-role') {
            window.alert('The group creator role cannot be changed.');
          }
          if (data.code === 'group-member-not-found') {
            window.alert('Selected user is not in this group anymore.');
          }
          if (data.code === 'group-call-not-active') {
            autoJoinGroupIdRef.current = null;
            window.alert('No ongoing call found in this group right now.');
          }
          if (data.code === 'invalid-group-name') {
            window.alert('Please enter a valid group name.');
          }
          if (data.code === 'invalid-voice-payload') {
            window.alert('Voice note failed to send. Please record again.');
          }
          if (data.code === 'payload-too-large') {
            window.alert('Voice note payload was too large. Try a shorter recording.');
          }
          if (data.code === 'rate-limited' || data.code === 'server-processing-error') {
            setIsConnected(false);
            setTimeout(() => wsRef.current?.reconnectNow?.(), 1200);
          }
          return;
        }

        if (data.action === 'hello-ack') {
          authReadyRef.current = true;
          setAuthScreenOpen(false);
          setUsers(data.users || []);
          setGroups(data.groups || []);
          const nextProfile = {
            userId: data.profile?.userId || data.userId || profileRef.current.userId,
            username: data.profile?.username || profileRef.current.username,
            avatar: data.profile?.avatar || '',
            about: data.profile?.about || 'Hey there! I am using LAN Messenger.'
          };
          setProfile(nextProfile);
          setOnboardingName(nextProfile.username);
          setOnboardingAbout(nextProfile.about);
          return;
        }

        if (data.action === 'presence-update') {
          setUsers(data.users || []);
          return;
        }

        if (data.action === 'group-created') {
          setGroups((prev) => (prev.find((g) => g.id === data.group.id) ? prev : [data.group, ...prev]));
          return;
        }

        if (data.action === 'group-meta-response' || data.action === 'group-meta-updated') {
          if (data.group) {
            setGroups((prev) => {
              const exists = prev.some((g) => g.id === data.group.id);
              if (!exists) return [data.group, ...prev];
              return prev.map((g) => (g.id === data.group.id ? { ...g, ...data.group } : g));
            });
          }

          if (data.group?.id === activeConversationRef.current?.replace('group:', '')) {
            setGroupInfo({ group: data.group, members: data.members || [] });
          }
          return;
        }

        if (data.action === 'group-removed') {
          setGroups((prev) => prev.filter((g) => g.id !== data.groupId));
          setRecentConversations((prev) => prev.filter((id) => id !== `group:${data.groupId}`));
          setArchivedConversations((prev) => {
            const next = { ...prev };
            delete next[`group:${data.groupId}`];
            void saveSetting('archivedConversations', next);
            return next;
          });
          if (activeConversationRef.current === `group:${data.groupId}`) {
            setActive(null);
            setMessages([]);
            setShowInfoPanel(false);
          }
          return;
        }

        if (data.action === 'group-call-status') {
          setGroupCallStatus((prev) => ({
            ...prev,
            [data.groupId]: {
              ongoing: Boolean(data.ongoing),
              participants: data.participants || [],
              participantCount: Number(data.participantCount || 0),
              updatedAt: data.updatedAt || Date.now()
            }
          }));
          return;
        }

        if (data.action === 'group-call-join-request') {
          if (!localCallStreamRef.current || callState.groupId !== data.groupId) return;
          const pc = createPeerConnection(data.from, data.groupId);
          localCallStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localCallStreamRef.current));
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send('call-offer', { to: data.from, sdp: offer, groupId: data.groupId });
          return;
        }

        if (data.action === 'group-members-added-ack') {
          if (data.count > 0) {
            window.alert(`Added ${data.count} member(s) to group.`);
          } else {
            window.alert('No new members were added.');
          }
          return;
        }

        if (data.action === 'typing') {
          const conversation = data.to ? `dm:${dmConversationId(data.from, data.to)}` : `group:${data.groupId}`;
          setTypingSignal(conversation, data.from, data.isTyping);
          const key = `${conversation}:${data.from}`;
          if (typingTimers.current.has(key)) clearTimeout(typingTimers.current.get(key));
          const timer = setTimeout(() => setTypingSignal(conversation, data.from, false), 1300);
          typingTimers.current.set(key, timer);
          return;
        }

        if (data.action === 'direct-message' || data.action === 'group-message') {
          const plain = await decryptJson(aesSecretRef.current, data.payload);
          const conversationId = data.action === 'direct-message' ? `dm:${dmConversationId(data.from, data.to)}` : `group:${data.groupId}`;
          markConversationRecent(conversationId);
          if (data.from !== profileRef.current.userId && activeConversationRef.current !== conversationId) {
            incrementUnread(conversationId);
          }

          if (data.action === 'direct-message' && data.from !== profileRef.current.userId && activeConversationRef.current === conversationId) {
            wsRef.current?.send('direct-read', { peerId: data.from, ids: [data.id] });
            readReceiptSentRef.current.add(data.id);
          }

          const isPhoto = plain.photo && typeof plain.photo === 'string';
          const messageData = {
            id: data.id,
            conversationId,
            from: data.from,
            to: data.to || null,
            groupId: data.groupId || null,
            type: isPhoto ? 'photo' : 'text',
            createdAt: data.createdAt,
            mine: data.from === profileRef.current.userId,
            status: 'delivered',
            expiresAt: data.expiresAt || null
          };

          if (isPhoto) {
            messageData.photoUrl = plain.photo;
          } else {
            messageData.text = plain.text;
          }

          await appendMessage(messageData);
          return;
        }

        if (data.action === 'direct-message-ack') {
          updateMessageStatus(data.id, 'delivered');
          return;
        }

        if (data.action === 'group-message-ack') {
          updateMessageStatus(data.id, 'sent');
          return;
        }

        if (data.action === 'direct-delivered') {
          updateMessageStatus(data.id, 'delivered');
          return;
        }

        if (data.action === 'direct-read') {
          for (const id of data.ids || []) {
            updateMessageStatus(id, 'read');
          }
          return;
        }

        if (data.action === 'history-response') {
          for (const row of data.messages || []) {
            let decryptedText = '[Encrypted message]';
            let photoUrl = null;
            let expiresAt = null;
            let messageType = 'text';
            try {
              const parsed = JSON.parse(row.payload);
              let encryptedPayload = parsed;
              if (parsed?.encrypted) {
                encryptedPayload = parsed.encrypted;
                expiresAt = parsed.expiresAt || null;
              }

              if (encryptedPayload?.cipher) {
                const plain = await decryptJson(aesSecretRef.current, encryptedPayload);
                if (plain.photo && typeof plain.photo === 'string') {
                  photoUrl = plain.photo;
                  messageType = 'photo';
                } else {
                  decryptedText = plain.text;
                }
              }
            } catch {
              // ignore decrypt issues for mismatched keys
            }

            const conversationId = row.group_id ? `group:${row.group_id}` : `dm:${dmConversationId(row.from_user, row.to_user)}`;
            const mine = row.from_user === profileRef.current.userId;
            const existing = await loadMessageById(row.id);
            const baselineStatus = mine
              ? (row.group_id ? 'sent' : 'delivered')
              : undefined;
            const chosenStatus = statusWeight(existing?.status) > statusWeight(baselineStatus)
              ? existing?.status
              : baselineStatus;

            const messageData = {
              id: row.id,
              conversationId,
              from: row.from_user,
              to: row.to_user,
              groupId: row.group_id,
              type: row.kind === 'voice-note' ? 'voice' : messageType,
              createdAt: row.created_at,
              mine,
              status: chosenStatus,
              expiresAt
            };

            if (row.kind === 'voice-note') {
              messageData.text = '[Voice note: available on receiving device only]';
            } else if (messageType === 'photo') {
              messageData.photoUrl = photoUrl;
            } else {
              messageData.text = decryptedText;
            }

            await saveMessage(messageData);
          }

          if (activeConversationRef.current) {
            const rows = await loadMessagesByConversation(activeConversationRef.current);
            setMessages(rows.sort((a, b) => a.createdAt - b.createdAt));
          }
          return;
        }

        if (data.action === 'chat-deleted') {
          const conversationId = data.groupId
            ? `group:${data.groupId}`
            : `dm:${dmConversationId(profileRef.current.userId, data.peerId)}`;

          await deleteMessagesByConversation(conversationId);
          clearUnread(conversationId);
          if (activeConversationRef.current === conversationId) {
            setMessages([]);
          }
          return;
        }

        if (data.action === 'temp-chat-updated') {
          const conversationId = data.groupId
            ? `group:${data.groupId}`
            : `dm:${dmConversationId(profileRef.current.userId, data.peerId)}`;

          setTempChatSettings((prev) => {
            const next = {
              ...prev,
              [conversationId]: { durationMs: data.durationMs, expiresAt: data.expiresAt }
            };
            void saveSetting('tempChatSettings', next);
            return next;
          });
          return;
        }

        if (data.action === 'temp-chat-cleared') {
          const conversationId = data.groupId
            ? `group:${data.groupId}`
            : `dm:${dmConversationId(profileRef.current.userId, data.peerId)}`;

          setTempChatSettings((prev) => {
            const next = { ...prev };
            delete next[conversationId];
            void saveSetting('tempChatSettings', next);
            return next;
          });
          return;
        }

        if (data.action === 'voice-note-start') {
          incomingVoiceRef.current.set(data.clipId, {
            from: data.from,
            to: data.to || null,
            groupId: data.groupId || null,
            mimeType: data.mimeType || 'audio/webm',
            parts: []
          });
          return;
        }

        if (data.action === 'voice-note-chunk') {
          const bucket = incomingVoiceRef.current.get(data.clipId);
          if (!bucket) return;
          const bytes = await decryptBytes(aesSecretRef.current, data.payload);
          bucket.parts.push(new Blob([bytes], { type: bucket.mimeType }));
          return;
        }

        if (data.action === 'voice-note-end') {
          const bucket = incomingVoiceRef.current.get(data.clipId);
          if (!bucket) return;

          const blob = new Blob(bucket.parts, { type: bucket.mimeType });
          const conversationId = bucket.groupId ? `group:${bucket.groupId}` : `dm:${dmConversationId(bucket.from, bucket.to)}`;
          if (bucket.from !== profileRef.current.userId && activeConversationRef.current !== conversationId) {
            incrementUnread(conversationId);
          }

          await appendMessage({
            id: data.clipId,
            conversationId,
            from: bucket.from,
            to: bucket.to,
            groupId: bucket.groupId,
            type: 'voice',
            voiceUrl: URL.createObjectURL(blob),
            createdAt: data.createdAt,
            mine: bucket.from === profileRef.current.userId
          });

          incomingVoiceRef.current.delete(data.clipId);
          return;
        }

        if (data.action === 'call-offer') {
          const shouldAutoJoin = Boolean(data.groupId && autoJoinGroupIdRef.current === data.groupId);
          const incomingLabel = data.groupId ? 'Incoming group conference call. Accept?' : 'Incoming voice call. Accept?';
          const accepted = shouldAutoJoin ? true : window.confirm(incomingLabel);
          if (!accepted) {
            ws.send('call-end', { to: data.from, reason: 'declined', groupId: data.groupId || null });
            return;
          }
          if (shouldAutoJoin) {
            autoJoinGroupIdRef.current = null;
          }

          let stream = localCallStreamRef.current;
          if (!stream) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localCallStreamRef.current = stream;
          }
          const pc = createPeerConnection(data.from, data.groupId || null);
          stream.getTracks().forEach((t) => pc.addTrack(t, stream));

          await pc.setRemoteDescription(data.sdp);
          const pendingForPeer = pendingIceRef.current.get(data.from) || [];
          for (const candidate of pendingForPeer) {
            await pc.addIceCandidate(candidate).catch(() => {});
          }
          pendingIceRef.current.set(data.from, []);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send('call-answer', { to: data.from, sdp: answer, groupId: data.groupId || null });
          setCallState((prev) => ({
            status: 'ringing',
            peerId: data.from,
            peerIds: Array.from(new Set([...prev.peerIds, data.from])),
            mode: 'webrtc',
            groupId: data.groupId || prev.groupId || null,
            conference: Boolean(data.groupId || prev.conference)
          }));
          return;
        }

        if (data.action === 'call-answer') {
          const pc = peerConnsRef.current.get(data.from);
          if (!pc) return;
          await pc.setRemoteDescription(data.sdp);
          const pendingForPeer = pendingIceRef.current.get(data.from) || [];
          for (const candidate of pendingForPeer) {
            await pc.addIceCandidate(candidate).catch(() => {});
          }
          pendingIceRef.current.set(data.from, []);
          setCallState((prev) => ({
            ...prev,
            status: 'connected',
            peerId: data.from,
            peerIds: Array.from(new Set([...prev.peerIds, data.from]))
          }));
          return;
        }

        if (data.action === 'call-ice' && data.candidate) {
          const pc = peerConnsRef.current.get(data.from);
          if (!pc || !pc.remoteDescription) {
            const queue = pendingIceRef.current.get(data.from) || [];
            queue.push(data.candidate);
            pendingIceRef.current.set(data.from, queue);
            return;
          }
          try {
            await pc.addIceCandidate(data.candidate);
          } catch {
            // candidate can race against SDP set
          }
          return;
        }

        if (data.action === 'call-end') {
          closePeerConnection(data.from);
          const remainingPeers = Array.from(peerConnsRef.current.keys());
          if (!remainingPeers.length) {
            destroyCall();
            return;
          }
          setCallState((prev) => ({
            ...prev,
            peerId: remainingPeers[0],
            peerIds: remainingPeers,
            status: 'connected'
          }));
          return;
        }

        if (data.action === 'call-fallback') {
          setCallState((prev) => ({ ...prev, status: 'fallback', peerId: data.from, mode: 'ws-audio' }));
        }
      }
    });

    ws.connect();
    wsRef.current = ws;

    return () => {
      ws.close();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
      }
      stopVoiceVisualizer();
      typingTimers.current.forEach((timer) => clearTimeout(timer));
      destroyCall();
    };
  }, []);

  useEffect(() => {
    if (!active || active.type !== 'direct') return;
    const idsToAck = messages
      .filter((m) => !m.mine && !readReceiptSentRef.current.has(m.id))
      .map((m) => m.id);

    if (!idsToAck.length) return;
    wsRef.current?.send('direct-read', { peerId: active.id, ids: idsToAck });
    idsToAck.forEach((id) => readReceiptSentRef.current.add(id));
  }, [active, messages]);

  const sendTyping = (isTyping) => {
    if (!active) return;
    if (active.type === 'direct') {
      wsRef.current?.send('typing', { to: active.id, isTyping });
    } else {
      wsRef.current?.send('typing', { groupId: active.id, isTyping });
    }
  };

  const requestHistory = (target) => {
    if (!target) return;
    if (target.type === 'direct') {
      wsRef.current?.send('history-request', { peerId: target.id });
    } else {
      wsRef.current?.send('history-request', { groupId: target.id });
    }
  };

  const openChat = (chat) => {
    setActive(chat);
    setShowDirectory(false);
    setChatMenuOpen(false);
    setEmojiPickerOpen(false);
    const id = convKey(chat, profile.userId);
    clearUnread(id);
    markConversationRecent(id);
    requestHistory(chat);
    if (chat.type === 'group') {
      wsRef.current?.send('group-call-status-request', { groupId: chat.id });
    }
    if (isMobile) {
      setIsMessageOpen(true);
      setShowInfoPanel(false);
    }
  };

  const joinOngoingGroupCall = () => {
    if (!active || active.type !== 'group') return;
    autoJoinGroupIdRef.current = active.id;
    wsRef.current?.send('group-call-join', { groupId: active.id });
  };

  const sendText = async () => {
    const trimmed = text.trim();
    if (!trimmed || !active) return;

    const id = randomId();
    const createdAt = Date.now();
    const encrypted = await encryptJson(aesSecret, { text: trimmed, sentAt: createdAt });

    if (active.type === 'direct') {
      wsRef.current?.send('direct-message', { id, to: active.id, payload: encrypted, createdAt });
    } else {
      wsRef.current?.send('group-message', { id, groupId: active.id, payload: encrypted, createdAt });
    }

    const localExpiresAt = activeTempSetting ? Date.now() + activeTempSetting.durationMs : null;
    markConversationRecent(activeConversationKey);

    await appendMessage({
      id,
      conversationId: activeConversationKey,
      from: profile.userId,
      to: active.type === 'direct' ? active.id : null,
      groupId: active.type === 'group' ? active.id : null,
      type: 'text',
      text: trimmed,
      createdAt,
      mine: true,
      status: 'sending',
      expiresAt: localExpiresAt
    });

    setText('');
    sendTyping(false);
  };

  const openCreateGroupDialog = () => {
    setGroupNameDraft('');
    setGroupSelectedMembers([]);
    setGroupDialogOpen(true);
  };

  const toggleGroupMemberSelection = (memberId) => {
    setGroupSelectedMembers((prev) => (
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    ));
  };

  const createGroup = () => {
    const name = groupNameDraft.trim();
    if (!name) {
      window.alert('Please enter a group name.');
      return;
    }

    const members = groupSelectedMembers.filter((id) => id !== profile.userId);

    wsRef.current?.send('create-group', { name, members });
    setGroupDialogOpen(false);
    setGroupNameDraft('');
    setGroupSelectedMembers([]);
  };

  const addMembersToActiveGroup = () => {
    if (!active || active.type !== 'group') return;
    setShowInfoPanel(true);
    setChatMenuOpen(false);
  };

  const toggleGroupAddCandidate = (memberId) => {
    setGroupMembersToAdd((prev) => (
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    ));
  };

  const saveActiveGroupName = () => {
    if (!activeGroup) return;
    const cleaned = groupNameEditDraft.trim().slice(0, 64);
    if (!cleaned) {
      window.alert('Group name is required.');
      return;
    }
    wsRef.current?.send('group-rename', { groupId: activeGroup.id, name: cleaned });
  };

  const addSelectedMembersToActiveGroup = () => {
    if (!activeGroup || !isActiveGroupAdmin) return;
    const members = groupMembersToAdd.filter((id) => id && id !== profile.userId);
    if (!members.length) {
      window.alert('Select at least one user to add.');
      return;
    }
    wsRef.current?.send('add-group-members', { groupId: activeGroup.id, members });
    setGroupMembersToAdd([]);
  };

  const removeMemberFromActiveGroup = (memberId) => {
    if (!activeGroup || !isActiveGroupAdmin) return;
    wsRef.current?.send('remove-group-member', { groupId: activeGroup.id, memberId });
  };

  const setActiveGroupMemberRole = (memberId, role) => {
    if (!activeGroup || !isActiveGroupCreator) return;
    wsRef.current?.send('set-group-member-role', { groupId: activeGroup.id, memberId, role });
  };

  const resetVoiceDraft = () => {
    setVoiceDraft((prev) => {
      if (prev.url) URL.revokeObjectURL(prev.url);
      return { blob: null, url: '', mimeType: 'audio/webm' };
    });
    setVoiceWaveform([]);
  };

  const stopVoiceVisualizer = () => {
    if (waveformRafRef.current) {
      cancelAnimationFrame(waveformRafRef.current);
      waveformRafRef.current = 0;
    }

    try {
      analyserRef.current?.disconnect?.();
    } catch {
      // ignore cleanup issues
    }
    analyserRef.current = null;

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const startVoiceVisualizer = (stream) => {
    if (typeof window.AudioContext === 'undefined' && typeof window.webkitAudioContext === 'undefined') {
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    audioContextRef.current = audioCtx;
    analyserRef.current = analyser;
    waveformPaintAtRef.current = 0;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = (ts) => {
      if (!analyserRef.current) return;
      analyser.getByteTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sumSq += v * v;
      }

      const rms = Math.sqrt(sumSq / data.length);
      const normalized = Math.max(0.08, Math.min(1, rms * 4));

      if (ts - waveformPaintAtRef.current > 70) {
        waveformPaintAtRef.current = ts;
        setVoiceWaveform((prev) => [...prev.slice(-31), normalized]);
      }

      waveformRafRef.current = requestAnimationFrame(loop);
    };

    waveformRafRef.current = requestAnimationFrame(loop);
  };

  const startVoiceRecording = async () => {
    if (!active || mediaRecorderRef.current) return;

    if (!wsRef.current?.ws || wsRef.current.ws.readyState !== WebSocket.OPEN) {
      window.alert('Not connected yet. Please wait for connection, then try recording again.');
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      window.alert('Voice notes are not supported on this browser.');
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      window.alert('Microphone access failed. Allow mic permissions and use HTTPS if your browser blocks audio on HTTP.');
      return;
    }

    let rec;
    try {
      rec = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      window.alert('Voice recorder could not start on this device/browser.');
      return;
    }

    const clipId = randomId();
    voiceRecordingRef.current = { startedAt: Date.now(), clipId };

    recordingStreamRef.current = stream;
    recordingChunksRef.current = [];
    localVoiceChunksRef.current = [];
    resetVoiceDraft();
    setIsRecordingVoice(true);
    startVoiceVisualizer(stream);

    rec.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      recordingChunksRef.current.push(event.data);
      localVoiceChunksRef.current.push(event.data);
    };

    rec.onstop = async () => {
      setIsRecordingVoice(false);
      stopVoiceVisualizer();

      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
      }

      if (!recordingChunksRef.current.length) {
        mediaRecorderRef.current = null;
        return;
      }

      const blob = new Blob(recordingChunksRef.current, { type: rec.mimeType || 'audio/webm' });
      const url = URL.createObjectURL(blob);
      setVoiceDraft({ blob, url, mimeType: rec.mimeType || 'audio/webm' });

      mediaRecorderRef.current = null;
    };

    rec.start(320);
    mediaRecorderRef.current = rec;
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.requestData();
      mediaRecorderRef.current.stop();
    }
  };

  const sendRecordedVoice = async () => {
    if (!voiceDraft.blob || !active) return;

    if (!wsRef.current?.ws || wsRef.current.ws.readyState !== WebSocket.OPEN) {
      window.alert('Not connected yet. Please wait for connection, then try sending again.');
      return;
    }

    const clipId = randomId();
    const createdAt = Date.now();
    const targetPayload = active.type === 'direct' ? { to: active.id } : { groupId: active.id };
    const bytes = new Uint8Array(await voiceDraft.blob.arrayBuffer());
    const chunkSize = 12 * 1024;

    wsRef.current?.send('voice-note-start', {
      clipId,
      mimeType: voiceDraft.mimeType || 'audio/webm',
      ...targetPayload
    });

    let seq = 0;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const part = bytes.slice(offset, Math.min(offset + chunkSize, bytes.length));
      const payload = await encryptBytes(aesSecretRef.current, part);
      wsRef.current?.send('voice-note-chunk', {
        clipId,
        seq: seq++,
        payload,
        mimeType: voiceDraft.mimeType || 'audio/webm',
        ...targetPayload
      });
    }

    wsRef.current?.send('voice-note-end', {
      clipId,
      mimeType: voiceDraft.mimeType || 'audio/webm',
      ...targetPayload
    });

    await appendMessage({
      id: clipId,
      conversationId: activeConversationKey,
      from: profile.userId,
      to: active.type === 'direct' ? active.id : null,
      groupId: active.type === 'group' ? active.id : null,
      type: 'voice',
      voiceUrl: voiceDraft.url,
      createdAt,
      mine: true,
      status: 'sent'
    });

    setVoiceDraft({ blob: null, url: '', mimeType: 'audio/webm' });
    setVoiceWaveform([]);
  };

  const startCall = async () => {
    if (!active) return;

    const peers = active.type === 'group'
      ? activeGroupMembers.filter((member) => member.id !== profile.userId && member.online).map((member) => member.id)
      : [active.id];

    if (!peers.length) {
      window.alert(active.type === 'group' ? 'No online group members available for conference call.' : 'User is not available for calling right now.');
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      window.alert('Call failed to access microphone. Allow mic permissions and use HTTPS if your browser blocks calls on HTTP.');
      return;
    }

    localCallStreamRef.current = stream;
    const conferenceGroupId = active.type === 'group' ? active.id : null;
    for (const peerId of peers) {
      const pc = createPeerConnection(peerId, conferenceGroupId);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsRef.current?.send('call-offer', { to: peerId, sdp: offer, groupId: conferenceGroupId });
    }

    setCallState({
      status: 'calling',
      peerId: peers[0],
      peerIds: peers,
      mode: 'webrtc',
      groupId: conferenceGroupId,
      conference: Boolean(conferenceGroupId)
    });
  };

  const endCall = () => {
    const peersToEnd = callState.peerIds.length ? callState.peerIds : (callState.peerId ? [callState.peerId] : []);
    peersToEnd.forEach((peerId) => {
      wsRef.current?.send('call-end', { to: peerId, reason: 'hangup', groupId: callState.groupId || null });
    });
    destroyCall();
  };

  const toggleMute = () => {
    if (!localCallStreamRef.current) return;
    const next = !isMuted;
    localCallStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setIsMuted(next);
  };

  const toggleSpeaker = () => {
    const next = !isSpeakerOn;
    setIsSpeakerOn(next);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = next ? 1 : 0.25;
    }
  };

  const deleteActiveChat = async () => {
    if (!active) return;
    const ok = window.confirm('Delete this chat history?');
    if (!ok) return;

    if (active.type === 'direct') {
      wsRef.current?.send('delete-chat', { peerId: active.id });
    } else {
      wsRef.current?.send('delete-chat', { groupId: active.id });
    }

    await deleteMessagesByConversation(activeConversationKey);
    setMessages([]);
    setChatMenuOpen(false);
  };

  const toggleMuteConversation = async (chat) => {
    const conversationId = convKey(chat, profile.userId);
    setMutedConversations((prev) => {
      const next = { ...prev, [conversationId]: !prev[conversationId] };
      void saveSetting('mutedConversations', next);
      return next;
    });
    setChatRowMenuOpen('');
  };

  const archiveConversation = async (chat, archived) => {
    const conversationId = convKey(chat, profile.userId);
    setArchivedConversations((prev) => {
      const next = { ...prev, [conversationId]: archived };
      void saveSetting('archivedConversations', next);
      return next;
    });
    setChatRowMenuOpen('');
  };

  const deleteConversation = async (chat) => {
    const conversationId = convKey(chat, profile.userId);
    const ok = window.confirm('Delete this chat history?');
    if (!ok) return;

    if (chat.type === 'direct') {
      wsRef.current?.send('delete-chat', { peerId: chat.id });
    } else {
      wsRef.current?.send('delete-chat', { groupId: chat.id });
    }

    await deleteMessagesByConversation(conversationId);
    clearUnread(conversationId);
    setRecentConversations((prev) => {
      const next = prev.filter((id) => id !== conversationId);
      void saveSetting('recentConversations', next);
      return next;
    });

    if (active && active.id === chat.id && active.type === chat.type) {
      setMessages([]);
      setActive(null);
    }

    setArchivedConversations((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      void saveSetting('archivedConversations', next);
      return next;
    });
    setChatRowMenuOpen('');
  };

  const setTemporaryChat = (durationMs) => {
    if (!active) return;
    if (active.type === 'direct') {
      wsRef.current?.send('set-temp-chat', { peerId: active.id, durationMs });
    } else {
      wsRef.current?.send('set-temp-chat', { groupId: active.id, durationMs });
    }
    setChatMenuOpen(false);
  };

  const clearTemporaryChat = () => {
    if (!active) return;
    if (active.type === 'direct') {
      wsRef.current?.send('clear-temp-chat', { peerId: active.id });
    } else {
      wsRef.current?.send('clear-temp-chat', { groupId: active.id });
    }
    setChatMenuOpen(false);
  };

  const insertEmoji = (emoji) => {
    if (!active) return;
    setText((prev) => `${prev}${emoji}`);
    sendTyping(true);
  };

  const triggerProfilePhotoPicker = () => {
    profilePhotoInputRef.current?.click();
  };

  const onProfilePhotoSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      window.alert('Please choose an image file.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      window.alert('Profile photo must be 2MB or less.');
      return;
    }

    try {
      const avatarDataUrl = await compressAvatarToDataUrl(file);
      const nextProfile = { ...profileRef.current, avatar: avatarDataUrl };
      setProfile(nextProfile);
      sendHello(nextProfile, { profileUpdate: true });
    } catch {
      window.alert('Failed to process image. Please try another image.');
    }
  };

  const clearProfilePhoto = () => {
    const nextProfile = { ...profileRef.current, avatar: '' };
    setProfile(nextProfile);
    sendHello(nextProfile, { profileUpdate: true });
  };

  const triggerPhotoUpload = () => {
    photoInputRef.current?.click();
    setAttachmentMenuOpen(false);
  };

  const triggerQuickCamera = () => {
    cameraInputRef.current?.click();
    setAttachmentMenuOpen(false);
  };

  const onPhotoSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !active) return;

    if (!file.type.startsWith('image/')) {
      window.alert('Please choose an image file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      window.alert('Photo must be 5MB or less.');
      return;
    }

    try {
      const photoDataUrl = await compressPhotoToDataUrl(file);
      if (!photoDataUrl || photoDataUrl.length > 120000) {
        window.alert('Photo is still too large after compression. Please choose a smaller photo.');
        return;
      }

      await sendPhoto(photoDataUrl);
    } catch {
      window.alert('Failed to send photo. Please try again.');
    }
  };

  const sendPhoto = async (photoDataUrl) => {
    if (!active || !photoDataUrl) return;

    const id = randomId();
    const createdAt = Date.now();
    const encrypted = await encryptJson(aesSecret, { photo: photoDataUrl, sentAt: createdAt });

    if (active.type === 'direct') {
      wsRef.current?.send('direct-message', { id, to: active.id, payload: encrypted, contentType: 'photo', createdAt });
    } else {
      wsRef.current?.send('group-message', { id, groupId: active.id, payload: encrypted, contentType: 'photo', createdAt });
    }

    const localExpiresAt = activeTempSetting ? Date.now() + activeTempSetting.durationMs : null;
    markConversationRecent(activeConversationKey);

    await appendMessage({
      id,
      conversationId: activeConversationKey,
      from: profile.userId,
      to: active.type === 'direct' ? active.id : null,
      groupId: active.type === 'group' ? active.id : null,
      type: 'photo',
      photoUrl: photoDataUrl,
      createdAt,
      mine: true,
      status: 'sending',
      expiresAt: localExpiresAt
    });

    setText('');
    sendTyping(false);
  };

  const saveAbout = () => {
    const cleaned = aboutDraft.trim().slice(0, 120) || 'Hey there! I am using LAN Messenger.';
    const nextProfile = { ...profileRef.current, about: cleaned };
    setProfile(nextProfile);
    sendHello(nextProfile, { profileUpdate: true });
  };

  const saveProfileName = () => {
    const cleaned = nameDraft.trim().slice(0, 30);
    if (!cleaned) {
      window.alert('Name is required.');
      return;
    }

    const nextProfile = { ...profileRef.current, username: cleaned };
    setProfile(nextProfile);
    sendHello(nextProfile, { profileUpdate: true });
  };

  const saveProfilePin = async () => {
    const cleanedPin = newPinDraft.trim();
    const cleanedConfirm = newPinConfirmDraft.trim();
    if (!/^(\d{4}|\d{6})$/.test(cleanedPin) || !/^(\d{4}|\d{6})$/.test(cleanedConfirm)) {
      window.alert('PIN must be 4 digits or 6 digits.');
      return;
    }
    if (cleanedPin !== cleanedConfirm) {
      window.alert('PIN and Confirm PIN must match.');
      return;
    }

    setProfilePin(cleanedPin);
    profilePinRef.current = cleanedPin;
    await saveSetting('profilePin', cleanedPin);
    setNewPinDraft('');
    setNewPinConfirmDraft('');
    sendHello(profileRef.current, { profileUpdate: true });
  };

  const saveOnboarding = async () => {
    const cleanedName = onboardingName.trim().slice(0, 30);
    const cleanedAbout = onboardingAbout.trim().slice(0, 120) || 'Hey there! I am using LAN Messenger.';
    const cleanedPin = onboardingPin.trim();
    const cleanedConfirmPin = onboardingPinConfirm.trim();
    if (!cleanedName || !/^(\d{4}|\d{6})$/.test(cleanedPin) || !/^(\d{4}|\d{6})$/.test(cleanedConfirmPin)) {
      window.alert('Username is required and PIN must be 4 digits or 6 digits.');
      return;
    }
    if (cleanedPin !== cleanedConfirmPin) {
      window.alert('PIN and Confirm PIN must match.');
      return;
    }

    const cleanedKey = (aesSecretRef.current || '').trim() || 'lan-local-key';

    const nextProfile = {
      ...profileRef.current,
      username: cleanedName,
      about: cleanedAbout
    };
    setProfile(nextProfile);
    setAboutDraft(cleanedAbout);
    setProfilePin(cleanedPin);
    profilePinRef.current = cleanedPin;
    authReadyRef.current = true;
    setAuthMode('signup');
    authModeRef.current = 'new';
    setAesSecret(cleanedKey);
    await saveSetting('aesSecret', cleanedKey);
    await saveSetting('profilePin', cleanedPin);
    setOnboardingPinConfirm('');

    sendHello(nextProfile, { profileUpdate: false, authMode: 'new' });
  };

  const typingIds = typing[activeConversationKey] || [];
  const typingNames = typingIds
    .map((id) => users.find((u) => u.id === id)?.username)
    .filter(Boolean)
    .join(', ');

  const activeName = active?.label || 'Choose a chat';
  const activeStatus = active?.type === 'group'
    ? 'Group conversation'
    : users.find((u) => u.id === active?.id)?.online
      ? 'Online'
      : 'Offline';
  const callPeer = users.find((u) => u.id === callState.peerId) || null;
  const callName = callState.conference
    ? `${activeGroupInfo?.group?.name || activeName} Conference`
    : callPeer?.username || (active?.type === 'direct' ? active.label : 'Unknown user');
  const callStatusLabel = {
    calling: callState.conference ? `Calling ${callState.peerIds.length} participant(s)...` : 'Calling... ',
    ringing: callState.conference ? 'Joining conference...' : 'Ringing... ',
    connected: callState.conference ? `${peerConnsRef.current.size} participant(s) connected` : 'Connected',
    fallback: 'Connected (fallback audio)'
  }[callState.status] || (callState.conference ? 'Starting conference...' : 'Connecting...');
  const callOverlayOpen = callState.status !== 'idle';
  const viewedProfile = canEditOwnProfile
    ? profile
    : {
        username: activeDirectUser?.username || activeName,
        avatar: activeDirectUser?.avatar || '',
        about: activeDirectUser?.about || 'No about set.',
        online: Boolean(activeDirectUser?.online)
      };

  const gridClass = [
    'main-grid',
    isMessageOpen ? 'is-message-open' : '',
    showInfoPanel ? 'is-main-info-open' : ''
  ].filter(Boolean).join(' ');
  const hasText = text.trim().length > 0;

  const handleComposerSubmit = (event) => {
    event?.preventDefault?.();
    void sendText();
  };

  const appendPin = (prev, digit) => (prev.length < 6 ? `${prev}${digit}` : prev);
  const trimPin = (prev) => prev.slice(0, -1);
  const loginPinMasked = loginPin.replace(/\d/g, '•');
  const signupPinMasked = onboardingPin.replace(/\d/g, '•');
  const signupPinConfirmMasked = onboardingPinConfirm.replace(/\d/g, '•');

  const handleLoginPinDigit = (digit) => {
    setLoginPin((prev) => appendPin(prev, digit));
  };

  const handleSignupPinDigit = (digit) => {
    if (signupPinField === 'confirm') {
      setOnboardingPinConfirm((prev) => appendPin(prev, digit));
      return;
    }
    setOnboardingPin((prev) => appendPin(prev, digit));
  };

  const handleSignupPinBackspace = () => {
    if (signupPinField === 'confirm') {
      setOnboardingPinConfirm((prev) => trimPin(prev));
      return;
    }
    setOnboardingPin((prev) => trimPin(prev));
  };

  const handleSignupPinClear = () => {
    if (signupPinField === 'confirm') {
      setOnboardingPinConfirm('');
      return;
    }
    setOnboardingPin('');
  };

  return (
    <>
      {!authScreenOpen && (
      <section className={gridClass}>
        <aside className="main-side">
          <header className="common-header">
            <div className="common-header-start">
              <button
                className="u-flex js-user-nav"
                onClick={() => {
                  setInfoPanelMode('self');
                  setShowInfoPanel(true);
                }}
              >
                <Avatar name={profile.username} avatar={profile.avatar} />
                <div className="common-header-content">
                  <h1 className="common-header-title">{profile.username}</h1>
                  <p className="common-header-status">{isConnected ? 'Connected' : 'Disconnected'} • {theme}</p>
                </div>
              </button>
            </div>
            <nav className="common-nav">
              <ul className="common-nav-list">
                <li className="common-nav-item"><button className="common-button" onClick={toggleTheme}><span className="icon icon-status" aria-label="status" /></button></li>
                <li className="common-nav-item"><button className={`common-button ${showDirectory ? 'is-active-control' : ''}`} onClick={() => setShowDirectory((v) => !v)}><span className="icon icon-new-chat" aria-label="new chat" /></button></li>
                <li className="common-nav-item chat-side-overflow" ref={sideMenuRef}>
                  <button className="common-button" onClick={() => setSideMenuOpen((v) => !v)}><span className="icon icon-menu" aria-label="chat options" /></button>
                  {sideMenuOpen && (
                    <div className="chat-side-overflow-menu">
                      <button
                        className="chat-overflow-item"
                        onClick={() => {
                          setShowArchivedChats((v) => !v);
                          setSideMenuOpen(false);
                        }}
                      >
                        {showArchivedChats ? 'Show active chats' : 'Show archived chats'}
                      </button>
                    </div>
                  )}
                </li>
              </ul>
            </nav>
          </header>

          <section className="common-alerts">
            <span className={`status-dot ${isConnected ? 'is-online' : ''}`} />
            <span>AES-GCM enabled</span>
          </section>

          <section className="common-search">
            <input
              type="search"
              className="text-input"
              placeholder={showDirectory ? 'Search all users' : 'Search chats'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </section>

          <section className="chats">
            {showDirectory && (
              <div className="directory-actions">
                <button className="common-button directory-create-group" onClick={openCreateGroupDialog}>+ New Group</button>
              </div>
            )}
            <ul className="chats-list">
              {showDirectory && onlineDirectoryUsers.length > 0 && <li className="chats-section-title">Online</li>}
              {showDirectory && onlineDirectoryUsers.map((u) => {
                const chat = { type: 'direct', id: u.id, label: u.username, online: true };
                const isActive = active?.id === chat.id && active?.type === chat.type;
                const conversationId = convKey(chat, profile.userId);
                const unread = unreadCounts[conversationId] || 0;

                return (
                  <li className="chats-item" key={`online:${u.id}`}>
                    <button className={`chats-item-button js-chat-button ${isActive ? 'is-active' : ''}`} onClick={() => openChat(chat)}>
                      <Avatar name={chat.label} avatar={u.avatar} />
                      <header className="chats-item-header">
                        <h3 className="chats-item-title">{chat.label}</h3>
                        <time className="chats-item-time">Online</time>
                      </header>
                      <div className="chats-item-content">
                        <p className="chats-item-last">Available now</p>
                        {unread > 0 && <span className="unread-messsages">{unread > 99 ? '99+' : unread}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}

              {showDirectory && offlineDirectoryUsers.length > 0 && <li className="chats-section-title">Offline</li>}
              {showDirectory && offlineDirectoryUsers.map((u) => {
                const chat = { type: 'direct', id: u.id, label: u.username, online: false };
                const isActive = active?.id === chat.id && active?.type === chat.type;
                const conversationId = convKey(chat, profile.userId);
                const unread = unreadCounts[conversationId] || 0;

                return (
                  <li className="chats-item" key={`offline:${u.id}`}>
                    <button className={`chats-item-button js-chat-button ${isActive ? 'is-active' : ''}`} onClick={() => openChat(chat)}>
                      <Avatar name={chat.label} avatar={u.avatar} />
                      <header className="chats-item-header">
                        <h3 className="chats-item-title">{chat.label}</h3>
                        <time className="chats-item-time">Offline</time>
                      </header>
                      <div className="chats-item-content">
                        <p className="chats-item-last">Will receive when online</p>
                        {unread > 0 && <span className="unread-messsages">{unread > 99 ? '99+' : unread}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}

              {showDirectory && onlineDirectoryUsers.length === 0 && offlineDirectoryUsers.length === 0 && (
                <li className="chats-empty">No other users discovered on this LAN yet.</li>
              )}

              {!showDirectory && combinedChats.length === 0 && (
                <li className="chats-empty">{showArchivedChats ? 'No archived chats yet.' : 'No recent chats yet. Tap New Chat to view all users.'}</li>
              )}

              {!showDirectory && combinedChats.map((chat) => {
                const isActive = active?.id === chat.id && active?.type === chat.type;
                const conversationId = convKey(chat, profile.userId);
                const unread = unreadCounts[conversationId] || 0;
                const chatAvatar = chat.type === 'direct' ? userById.get(chat.id)?.avatar : '';
                const menuKey = `${chat.type}:${chat.id}`;
                const isMutedConversation = Boolean(mutedConversations[conversationId]);
                const isArchivedConversation = Boolean(archivedConversations[conversationId]);
                return (
                  <li className="chats-item" key={`${chat.type}:${chat.id}`}>
                    <div className="chats-item-row">
                      <button className={`chats-item-button js-chat-button ${isActive ? 'is-active' : ''}`} onClick={() => openChat(chat)}>
                        <Avatar name={chat.label} avatar={chatAvatar} />
                        <header className="chats-item-header">
                          <h3 className="chats-item-title">{chat.label}</h3>
                          <time className="chats-item-time">{fmtTime(Date.now())}</time>
                        </header>
                        <div className="chats-item-content">
                          <p className="chats-item-last">{chat.type === 'group' ? 'Group chat' : chat.online ? 'Online now' : 'Offline'}</p>
                          <ul className="chats-item-info">
                            {(isMutedConversation || !chat.online) && <li className="chats-item-info-item"><span className="icon-silent">🔇</span></li>}
                            {unread > 0 && <li className="chats-item-info-item"><span className="unread-messsages">{unread > 99 ? '99+' : unread}</span></li>}
                          </ul>
                        </div>
                      </button>

                      <div className="chat-row-actions">
                        <button
                          type="button"
                          className="chat-row-toggle"
                          aria-label="chat options"
                          onClick={() => setChatRowMenuOpen((prev) => (prev === menuKey ? '' : menuKey))}
                        >
                          <span className="chat-row-toggle-icon" aria-hidden="true" />
                        </button>
                        {chatRowMenuOpen === menuKey && (
                          <div className="chat-row-menu">
                            <button className="chat-overflow-item" onClick={() => void toggleMuteConversation(chat)}>{isMutedConversation ? 'Unmute notifications' : 'Mute notifications'}</button>
                            <button className="chat-overflow-item" onClick={() => void archiveConversation(chat, !isArchivedConversation)}>{isArchivedConversation ? 'Unarchive chat' : 'Archive chat'}</button>
                            <button className="chat-overflow-item danger" onClick={() => void deleteConversation(chat)}>Delete chat</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>

        <main className="main-content">
          <header className="common-header">
            <div className="common-header-start">
              <button className="common-button is-only-mobile u-margin-end js-back" onClick={() => setIsMessageOpen(false)}><span className="icon icon-back" aria-label="back" /></button>
              <button
                className="u-flex js-side-info-button"
                onClick={() => {
                  if (!active) return;
                  setInfoPanelMode('chat');
                  if (active?.type === 'group') {
                    setShowInfoPanel(true);
                    wsRef.current?.send('group-meta-request', { groupId: active.id });
                    return;
                  }
                  setShowInfoPanel(true);
                }}
              >
                <Avatar
                  name={activeName}
                  avatar={active?.type === 'direct' ? userById.get(active.id)?.avatar : ''}
                />
                <div className="common-header-content">
                  <h2 className="common-header-title">{activeName}</h2>
                  <p className="common-header-status">{typingNames ? `${typingNames} typing...` : activeStatus}</p>
                </div>
              </button>
            </div>
            <nav className="common-nav">
              <ul className="common-nav-list">
                <li className="common-nav-item"><button className="common-button" onClick={() => setChatSearchQuery((q) => (q ? '' : search))}><span className="icon icon-search" aria-label="search" /></button></li>
                <li className="common-nav-item"><button className="common-button" onClick={active ? startCall : undefined}><span className="icon icon-phone" aria-label="call" /></button></li>
                <li className="common-nav-item chat-overflow" ref={chatMenuRef}>
                  <button className="common-button" onClick={() => setChatMenuOpen((v) => !v)}><span className="icon icon-menu" aria-label="menu" /></button>
                  {chatMenuOpen && (
                    <div className="chat-overflow-menu">
                      <button className="chat-overflow-item" disabled={!active} onClick={() => setTemporaryChat(10 * 60 * 1000)}>Temporary chat: 10m</button>
                      <button className="chat-overflow-item" disabled={!active} onClick={() => setTemporaryChat(15 * 60 * 1000)}>Temporary chat: 15m</button>
                      <button className="chat-overflow-item" disabled={!active} onClick={() => setTemporaryChat(60 * 60 * 1000)}>Temporary chat: 1h</button>
                      <button className="chat-overflow-item" disabled={!active} onClick={() => setTemporaryChat(2 * 60 * 60 * 1000)}>Temporary chat: 2h</button>
                      {active?.type === 'group' && <button className="chat-overflow-item" onClick={addMembersToActiveGroup}>Manage group</button>}
                      <button className="chat-overflow-item" disabled={!active} onClick={clearTemporaryChat}>Temporary chat: Off</button>
                      <button className="chat-overflow-item danger" disabled={!active} onClick={() => void deleteActiveChat()}>Delete chat history</button>
                    </div>
                  )}
                </li>
              </ul>
            </nav>
          </header>

          {chatSearchQuery && (
            <div className="chat-inline-search">
              <input
                className="text-input"
                value={chatSearchQuery}
                onChange={(e) => setChatSearchQuery(e.target.value)}
                placeholder="Search in conversation"
              />
            </div>
          )}

          <div className="messanger">
            <ol className="messanger-list">
              <li className="common-message is-time"><p className="common-message-content">Today</p></li>
              {visibleMessages.map((m) => (
                <li className={`common-message ${m.mine ? 'is-you' : 'is-other'}`} key={m.id}>
                  {m.type === 'text' ? (
                    <p className="common-message-content">{m.text}</p>
                  ) : m.type === 'photo' ? (
                    <div className="common-message-content"><img src={m.photoUrl} alt="Sent photo" className="message-photo" /></div>
                  ) : (
                    <div className="common-message-content"><audio controls src={m.voiceUrl} /></div>
                  )}
                  {m.mine && (
                    <span className={`status status-${m.status || 'sent'}`}>
                      <span className="tick" />
                      <span className="tick second" />
                    </span>
                  )}
                  <time>{fmtTime(m.createdAt)}</time>
                </li>
              ))}
            </ol>
          </div>

          <form className="message-box" onSubmit={handleComposerSubmit}>
            <div className="attachment-anchor" ref={attachmentMenuRef}>
              <button type="button" className="common-button" disabled={!active} onClick={() => setAttachmentMenuOpen((v) => !v)}><span className="icon icon-attach" aria-label="attach" /></button>
              {attachmentMenuOpen && (
                <div className="attachment-menu" role="dialog" aria-label="attachment options">
                  <button type="button" className="attachment-menu-item" onClick={triggerPhotoUpload}>
                    <span className="icon icon-gallery" aria-label="gallery" />
                    <span>Choose Photo</span>
                  </button>
                  <button type="button" className="attachment-menu-item" onClick={triggerQuickCamera}>
                    <span className="icon icon-camera" aria-label="camera" />
                    <span>Take Photo</span>
                  </button>
                </div>
              )}
            </div>
            <div className="emoji-anchor" ref={emojiPickerRef}>
              <button type="button" className="common-button" disabled={!active} onClick={() => setEmojiPickerOpen((v) => !v)}><span className="icon icon-emoji" aria-label="emoji" /></button>
              {emojiPickerOpen && (
                <div className="emoji-picker" role="dialog" aria-label="emoji picker">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button type="button" key={emoji} className="emoji-picker-item" onClick={() => insertEmoji(emoji)}>{emoji}</button>
                  ))}
                </div>
              )}
            </div>
            <input
              className="text-input"
              id="message-box"
              placeholder={active ? 'Type a message' : 'Select a chat to begin'}
              disabled={!active}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                sendTyping(Boolean(e.target.value));
              }}
            />
            {!hasText ? (
              <div className="voice-compose-controls">
                {(isRecordingVoice || voiceDraft.url) && (
                  <div className="voice-wave" aria-label="Voice waveform">
                    {(voiceWaveform.length ? voiceWaveform : Array.from({ length: 12 }, () => 0.1)).map((level, idx) => (
                      <span key={`${idx}-${level}`} className="voice-wave-bar" style={{ height: `${Math.max(4, Math.round(level * 26))}px` }} />
                    ))}
                  </div>
                )}

                {!isRecordingVoice && !voiceDraft.url && (
                  <button
                    type="button"
                    id="voice-button"
                    className="common-button"
                    disabled={!active}
                    onClick={() => void startVoiceRecording()}
                  >
                    <span className="icon icon-mic" aria-label="record" />
                  </button>
                )}

                {isRecordingVoice && (
                  <button
                    type="button"
                    id="voice-stop-button"
                    className="common-button voice-stop-button"
                    disabled={!active}
                    onClick={stopVoiceRecording}
                  >
                    <span className="icon icon-stop" aria-label="stop recording" />
                  </button>
                )}

                {!isRecordingVoice && voiceDraft.url && (
                  <button
                    type="button"
                    id="voice-send-button"
                    className="common-button send-button"
                    disabled={!active}
                    onClick={() => void sendRecordedVoice()}
                  >
                    <span className="icon icon-send" aria-label="send voice" />
                  </button>
                )}
              </div>
            ) : (
              <button
                type="submit"
                id="submit-button"
                className="common-button send-button"
                disabled={!active}
              >
                <span className="icon icon-send" aria-label="send" />
              </button>
            )}
          </form>
        </main>

        <aside className={`main-info ${showInfoPanel ? '' : 'u-hide'}`}>
          <header className="common-header">
            <button className="common-button js-close-main-info" onClick={() => setShowInfoPanel(false)}><span className="icon icon-close" aria-label="close" /></button>
            <div className="common-header-content">
              <h3 className="common-header-title">{infoPanelMode === 'chat' && active?.type === 'group' ? 'Group Info' : infoPanelMode === 'chat' ? 'User Profile' : 'Profile'}</h3>
            </div>
          </header>
          {infoPanelMode === 'chat' && active?.type === 'group' ? (
            <div className="main-info-content wa-profile-content">
              <section className="wa-profile-hero">
                <Avatar
                  name={activeGroupInfo?.group?.name || activeName}
                  avatar=""
                  className="main-info-image"
                />
                <h4 className="wa-profile-name">{activeGroupInfo?.group?.name || activeName}</h4>
              </section>

              {!activeGroupInfo && (
                <section className="wa-profile-group">
                  <article className="wa-profile-row">
                    <p className="wa-profile-value">Loading group details...</p>
                  </article>
                </section>
              )}

              {activeGroupInfo && (
                <>
                  <section className="wa-profile-group">
                    <article className="wa-profile-row">
                      <p className="wa-profile-label">Group Name</p>
                      <input
                        className="wa-profile-input"
                        maxLength={64}
                        value={groupNameEditDraft}
                        onChange={(e) => setGroupNameEditDraft(e.target.value)}
                      />
                      <button className="common-button wa-profile-save" onClick={saveActiveGroupName}>Save Name</button>
                    </article>
                    <article className="wa-profile-row">
                      <p className="wa-profile-label">Members ({activeGroupMembers.length})</p>
                      <div className="group-members-list">
                        {activeGroupMembers.map((member) => {
                          const isCreator = member.id === activeGroupInfo.group.created_by;
                          const canChangeRole = isActiveGroupCreator && !isCreator;
                          const canRemove = isActiveGroupAdmin && !isCreator;
                          return (
                            <div key={member.id} className="group-member-row">
                              <div className="group-member-main">
                                <Avatar name={member.username} avatar={member.avatar} className="group-member-avatar" />
                                <div className="group-member-text">
                                  <p className="group-member-title">
                                    {member.username}
                                    {member.id === profile.userId ? ' (You)' : ''}
                                  </p>
                                  <p className="group-member-meta">
                                    {isCreator ? 'Creator' : member.role === 'admin' ? 'Admin' : 'User'}
                                  </p>
                                </div>
                              </div>
                              <div className="group-member-actions">
                                {canChangeRole && member.role !== 'admin' && (
                                  <button className="common-button wa-profile-save" onClick={() => setActiveGroupMemberRole(member.id, 'admin')}>Make Admin</button>
                                )}
                                {canChangeRole && member.role === 'admin' && (
                                  <button className="common-button wa-profile-save" onClick={() => setActiveGroupMemberRole(member.id, 'member')}>Make User</button>
                                )}
                                {canRemove && (
                                  <button className="common-button wa-profile-save danger" onClick={() => removeMemberFromActiveGroup(member.id)}>Remove</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  </section>

                  {isActiveGroupAdmin && (
                    <section className="wa-profile-group">
                      <article className="wa-profile-row">
                        <p className="wa-profile-label">Add Members</p>
                        <div className="group-member-picker" role="listbox" aria-label="Select members to add" aria-multiselectable="true">
                          {addableActiveGroupUsers.length === 0 && <p className="group-member-empty">All users are already in this group.</p>}
                          {addableActiveGroupUsers.map((u) => {
                            const checked = groupMembersToAdd.includes(u.id);
                            return (
                              <label key={u.id} className={`group-member-option ${checked ? 'is-selected' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleGroupAddCandidate(u.id)}
                                />
                                <span className="group-member-name">{u.username}</span>
                                <span className="group-member-status">{u.online ? 'Online' : 'Offline'}</span>
                              </label>
                            );
                          })}
                        </div>
                        <button className="common-button wa-profile-save" onClick={addSelectedMembersToActiveGroup}>Add Selected Members</button>
                      </article>
                    </section>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="main-info-content wa-profile-content">
              <section className="wa-profile-hero">
                {canEditOwnProfile ? (
                  <button className="wa-profile-photo-button" onClick={triggerProfilePhotoPicker} type="button" title="Click to change profile photo">
                    <Avatar name={viewedProfile.username} avatar={viewedProfile.avatar} className="main-info-image" />
                  </button>
                ) : (
                  <Avatar name={viewedProfile.username} avatar={viewedProfile.avatar} className="main-info-image" />
                )}
                <h4 className="wa-profile-name">{viewedProfile.username}</h4>
              </section>

              <section className="wa-profile-group">
                {canEditOwnProfile ? (
                  <>
                    <article className="wa-profile-row">
                      <p className="wa-profile-label">Name</p>
                      <input
                        className="wa-profile-input"
                        maxLength={30}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                      />
                      <button className="common-button wa-profile-save" onClick={saveProfileName}>Save</button>
                    </article>
                    <article className="wa-profile-row">
                      <p className="wa-profile-label">About</p>
                      <input
                        className="wa-profile-input"
                        maxLength={120}
                        value={aboutDraft}
                        onChange={(e) => setAboutDraft(e.target.value)}
                      />
                      <button className="common-button wa-profile-save" onClick={saveAbout}>Save</button>
                    </article>
                    <article className="wa-profile-row">
                      <p className="wa-profile-label">Change PIN</p>
                      <input
                        className="wa-profile-input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        value={newPinDraft}
                        onChange={(e) => setNewPinDraft(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="New PIN (4 or 6 digits)"
                      />
                      <input
                        className="wa-profile-input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        value={newPinConfirmDraft}
                        onChange={(e) => setNewPinConfirmDraft(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="Confirm PIN"
                      />
                      <p className="wa-profile-hint">Use 4 digits or 6 digits.</p>
                      <button className="common-button wa-profile-save" onClick={() => void saveProfilePin()}>Update PIN</button>
                    </article>
                  </>
                ) : (
                  <>
                    <article className="wa-profile-row">
                      <p className="wa-profile-label">Name</p>
                      <p className="wa-profile-value">{viewedProfile.username}</p>
                    </article>
                    <article className="wa-profile-row">
                      <p className="wa-profile-label">About</p>
                      <p className="wa-profile-value">{viewedProfile.about}</p>
                    </article>
                    <article className="wa-profile-row">
                      <p className="wa-profile-label">Status</p>
                      <p className="wa-profile-value">{viewedProfile.online ? 'Online' : 'Offline'}</p>
                    </article>
                  </>
                )}
                <article className="wa-profile-row">
                  <p className="wa-profile-label">Encryption</p>
                  <p className="wa-profile-value">AES-GCM</p>
                </article>
              </section>

              {canEditOwnProfile && (
                <section className="wa-profile-group">
                  <div className="profile-photo-actions">
                    <button className="common-button profile-photo-button" onClick={triggerProfilePhotoPicker}>Change profile photo</button>
                    {profile.avatar && <button className="common-button profile-photo-remove" onClick={clearProfilePhoto}>Remove photo</button>}
                  </div>
                </section>
              )}
            </div>
          )}
        </aside>
      </section>
      )}

      {authScreenOpen && (
        <section className="auth-page">
          <div className={`auth-shell ${authMode === 'signup' ? 'is-signup' : 'is-login'}`}>
            <section className="auth-panel auth-panel-signup" aria-label="Create account panel">
              <h2 className="auth-title">Create Account</h2>
              <p className="auth-subtitle">Create your LAN profile and set a 4-digit or 6-digit PIN.</p>
              <label className="auth-label">
                Username
                <input
                  className="auth-input"
                  value={onboardingName}
                  maxLength={30}
                  onChange={(e) => setOnboardingName(e.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label className="auth-label">
                About
                <input
                  className="auth-input"
                  value={onboardingAbout}
                  maxLength={120}
                  onChange={(e) => setOnboardingAbout(e.target.value)}
                  placeholder="Short status"
                />
              </label>
              <label className="auth-label">
                Create PIN
                <button
                  type="button"
                  className={`auth-pin-display ${signupPinField === 'create' ? 'is-active' : ''}`}
                  onClick={() => setSignupPinField('create')}
                >
                  {signupPinMasked || '•••• or ••••••'}
                </button>
              </label>
              <label className="auth-label">
                Confirm PIN
                <button
                  type="button"
                  className={`auth-pin-display ${signupPinField === 'confirm' ? 'is-active' : ''}`}
                  onClick={() => setSignupPinField('confirm')}
                >
                  {signupPinConfirmMasked || '•••• or ••••••'}
                </button>
              </label>
              <PinPad
                onDigit={handleSignupPinDigit}
                onBackspace={handleSignupPinBackspace}
                onClear={handleSignupPinClear}
              />
              <button className="auth-submit" type="button" onClick={() => void saveOnboarding()}>SIGN UP</button>
            </section>

            <section className="auth-panel auth-panel-login" aria-label="Sign in panel">
              <h2 className="auth-title">Sign In</h2>
              <p className="auth-subtitle">Use your 4-digit or 6-digit PIN.</p>
              <label className="auth-label">
                PIN
                <div className="auth-pin-display">{loginPinMasked || '•••• or ••••••'}</div>
              </label>
              <PinPad
                onDigit={handleLoginPinDigit}
                onBackspace={() => setLoginPin((prev) => trimPin(prev))}
                onClear={() => setLoginPin('')}
              />
              <button className="auth-submit" type="button" onClick={() => void submitOldUserLogin()}>SIGN IN</button>
              <button className="auth-secondary" type="button" onClick={openNewUserSetup}>SIGN UP</button>
            </section>

            <aside className="auth-switch">
              <div className="auth-orb auth-orb-one" />
              <div className="auth-orb auth-orb-two" />
              {authMode === 'signup' ? (
                <div className="auth-switch-content">
                  <h3 className="auth-switch-title">Welcome Back!</h3>
                  <p className="auth-switch-copy">Sign in using your PIN to continue your chats.</p>
                  <button type="button" className="auth-switch-button" onClick={() => setAuthMode('login')}>SIGN IN</button>
                </div>
              ) : (
                <div className="auth-switch-content">
                  <h3 className="auth-switch-title">Hello Friend!</h3>
                  <p className="auth-switch-copy">Create your account and start chatting securely.</p>
                  <button type="button" className="auth-switch-button" onClick={openNewUserSetup}>SIGN UP</button>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      {!authScreenOpen && groupDialogOpen && (
        <div className="wizard-overlay" onClick={() => setGroupDialogOpen(false)}>
          <div className="wizard-card group-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Group</h2>
            <p>Add a name and select optional members.</p>
            <label>
              Group Name
              <input
                className="text-input wizard-input"
                value={groupNameDraft}
                maxLength={40}
                onChange={(e) => setGroupNameDraft(e.target.value)}
                placeholder="Team chat"
              />
            </label>
            <label>
              Members (optional)
              <div className="group-member-picker" role="listbox" aria-label="Select group members" aria-multiselectable="true">
                {visibleUsers.length === 0 && <p className="group-member-empty">No users available right now.</p>}
                {visibleUsers.map((u) => {
                  const checked = groupSelectedMembers.includes(u.id);
                  return (
                    <label key={u.id} className={`group-member-option ${checked ? 'is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleGroupMemberSelection(u.id)}
                      />
                      <span className="group-member-name">{u.username}</span>
                      <span className="group-member-status">{u.online ? 'Online' : 'Offline'}</span>
                    </label>
                  );
                })}
              </div>
            </label>
            <div className="wizard-actions group-dialog-actions">
              <button className="common-button" onClick={() => setGroupDialogOpen(false)}>Cancel</button>
              <button className="common-button wizard-save" onClick={createGroup}>Create Group</button>
            </div>
          </div>
        </div>
      )}

      {callOverlayOpen && (
        <div className="call-overlay" role="dialog" aria-label="Call interface">
          <div className="call-card">
            <Avatar name={callName} avatar={callPeer?.avatar} className="call-avatar" />
            <h3 className="call-title">{callName}</h3>
            <p className="call-subtitle">{callStatusLabel}</p>
            <div className="call-actions">
              <button type="button" className={`call-action ${isMuted ? 'is-active' : ''}`} onClick={toggleMute}>
                {isMuted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" className={`call-action ${isSpeakerOn ? 'is-active' : ''}`} onClick={toggleSpeaker}>
                {isSpeakerOn ? 'Speaker On' : 'Speaker Off'}
              </button>
              <button type="button" className="call-action danger" onClick={endCall}>End</button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={profilePhotoInputRef}
        type="file"
        accept="image/*"
        className="hidden-file-input"
        onChange={onProfilePhotoSelected}
      />

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden-file-input"
        onChange={onPhotoSelected}
      />

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden-file-input"
        onChange={onPhotoSelected}
      />
      <audio ref={remoteAudioRef} autoPlay hidden />
    </>
  );
}
