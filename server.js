import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(root, 'data');
const dataFile = path.join(dataDirectory, 'arena.json');
const port = Number(process.env.PORT) || 3000;
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function emptyState() {
  return {
    currentLeague: '',
    currentClubByCompetition: {},
    selectedSquad: '',
    clubs: [],
    players: [],
    matches: [],
    auctions: [],
    loans: [],
    competitions: [],
    competitionSettings: {},
    currentPage: 'overview',
  };
}

function normaliseState(value = {}) {
  const state = emptyState();
  for (const key of Object.keys(state)) {
    if (key === 'currentClubByCompetition' || key === 'competitionSettings') {
      state[key] = value[key] && typeof value[key] === 'object' && !Array.isArray(value[key]) ? value[key] : {};
    } else if (Array.isArray(state[key])) {
      state[key] = Array.isArray(value[key]) ? value[key] : [];
    } else if (typeof value[key] === 'string') {
      state[key] = value[key];
    }
  }
  return state;
}

function loadDatabase() {
  try {
    const saved = JSON.parse(readFileSync(dataFile, 'utf8'));
    return {
      users: Array.isArray(saved.users) ? saved.users : [],
      invites: Array.isArray(saved.invites) ? saved.invites : [],
      state: normaliseState(saved.state),
      revision: Number.isInteger(saved.revision) ? saved.revision : 0,
    };
  } catch {
    return { users: [], invites: [], state: emptyState(), revision: 0 };
  }
}

let database = loadDatabase();

function persistDatabase() {
  mkdirSync(dataDirectory, { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify(database, null, 2), 'utf8');
  renameSync(temporaryFile, dataFile);
}

function json(response, status, value, extraHeaders = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
}

function text(response, status, value, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(value);
}

async function readJson(request) {
  const pieces = [];
  let length = 0;
  for await (const piece of request) {
    length += piece.length;
    if (length > 4 * 1024 * 1024) throw new Error('A solicitação é grande demais.');
    pieces.push(piece);
  }
  if (!pieces.length) return {};
  return JSON.parse(Buffer.concat(pieces).toString('utf8'));
}

function passwordRecord(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return { salt: salt.toString('base64url'), hash: hash.toString('base64url') };
}

function passwordMatches(password, record) {
  try {
    const salt = Buffer.from(record.salt, 'base64url');
    const expected = Buffer.from(record.hash, 'base64url');
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function hashInvite(code) {
  return createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

function cookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map(part => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function publicUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    role: user.role,
    clubId: user.clubId || '',
  };
}

function activeUser(request) {
  const token = cookies(request).av_session;
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return database.users.find(user => user.id === session.userId) || null;
}

function setSession(response, user) {
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionLifetime });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `av_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}${secure}`);
}

function stateForUser(user) {
  const state = structuredClone(database.state);
  state.currentPage = 'overview';
  if (user.role === 'manager') {
    const club = state.clubs.find(item => item.id === user.clubId);
    if (club) {
      state.currentLeague = club.competition;
      state.currentClubByCompetition[club.competition] = club.id;
      state.selectedSquad = club.id;
    }
  }
  return state;
}

function authPayload(user) {
  return { stage: 'app', user: publicUser(user), state: stateForUser(user), revision: database.revision };
}

function namesAreValid(displayName, username, password) {
  return typeof displayName === 'string' && displayName.trim().length >= 2 && displayName.trim().length <= 60
    && typeof username === 'string' && /^[a-zA-Z0-9._-]{3,24}$/.test(username.trim())
    && typeof password === 'string' && password.length >= 8 && password.length <= 200;
}

function createUser({ displayName, username, password, role, clubId = '' }) {
  const record = passwordRecord(password);
  return {
    id: `u${randomBytes(9).toString('hex')}`,
    displayName: displayName.trim(),
    username: username.trim(),
    usernameKey: username.trim().toLowerCase(),
    role,
    clubId,
    ...record,
    createdAt: new Date().toISOString(),
  };
}

function recalculateStandings(state) {
  for (const club of state.clubs) {
    club.played = 0;
    club.wins = 0;
    club.draws = 0;
    club.losses = 0;
    club.gf = 0;
    club.ga = 0;
    club.form = [];
  }
  for (const match of state.matches) {
    if (match.status !== 'Encerrado') continue;
    const home = state.clubs.find(club => club.id === match.home);
    const away = state.clubs.find(club => club.id === match.away);
    if (!home || !away) continue;
    const homeScore = Number(match.homeScore) || 0;
    const awayScore = Number(match.awayScore) || 0;
    home.played++;
    away.played++;
    home.gf += homeScore;
    home.ga += awayScore;
    away.gf += awayScore;
    away.ga += homeScore;
    if (homeScore > awayScore) {
      home.wins++;
      away.losses++;
    } else if (awayScore > homeScore) {
      away.wins++;
      home.losses++;
    } else {
      home.draws++;
      away.draws++;
    }
  }
}

function addedLedgerEntries(previous, next) {
  const previousIds = new Set((previous || []).map(entry => entry.id));
  return (next || []).filter(entry => !previousIds.has(entry.id));
}

function mergeManagerState(user, submitted) {
  const current = database.state;
  const ownId = user.clubId;
  const ownBefore = current.clubs.find(club => club.id === ownId);
  if (!ownBefore) throw new Error('O clube deste manager não está mais disponível.');
  const incoming = normaliseState(submitted);
  const incomingClubs = new Map(incoming.clubs.map(club => [club.id, club]));
  if (incoming.clubs.length !== current.clubs.length) throw new Error('Manager não pode adicionar ou remover clubes.');

  const next = structuredClone(current);
  const ownAfter = incomingClubs.get(ownId);
  if (!ownAfter) throw new Error('O clube deste manager não pode ser removido.');

  let totalBudgetChange = 0;
  const positiveTransfers = [];
  const ownLedgerAdds = addedLedgerEntries(ownBefore.ledger, ownAfter.ledger);
  const ownBudgetChange = Number(ownAfter.budget) - Number(ownBefore.budget);
  if (!Number.isFinite(ownBudgetChange) || Number(ownAfter.budget) < 0) throw new Error('Saldo inválido.');
  if (ownLedgerAdds.some(entry => !Number.isFinite(Number(entry.amount)) || Number(entry.amount) >= 0 || entry.type !== 'Saída')) {
    throw new Error('O manager só pode registrar pagamentos que saiam do próprio clube.');
  }
  if (ownLedgerAdds.reduce((sum, entry) => sum + Number(entry.amount), 0) !== ownBudgetChange) {
    throw new Error('O saldo e o extrato do clube não correspondem. Atualize a página e tente novamente.');
  }
  ownAfter.ledger = [...ownBefore.ledger || [], ...ownLedgerAdds];
  totalBudgetChange += ownBudgetChange;

  next.clubs = current.clubs.map(club => {
    const submittedClub = incomingClubs.get(club.id);
    if (!submittedClub) throw new Error('Clube inválido na atualização.');
    if (club.id === ownId) {
      const merged = { ...club, budget: Number(ownAfter.budget), ledger: ownAfter.ledger };
      return merged;
    }
    const protectedFields = ['name', 'country', 'short', 'competition', 'manager', 'color'];
    if (protectedFields.some(key => submittedClub[key] !== club[key])) throw new Error('Você só pode alterar os dados do seu próprio clube.');
    const budgetChange = Number(submittedClub.budget) - Number(club.budget);
    if (!Number.isFinite(budgetChange) || budgetChange < 0) throw new Error('Você não pode retirar dinheiro de outro clube.');
    const additions = addedLedgerEntries(club.ledger, submittedClub.ledger);
    if (additions.some(entry => Number(entry.amount) <= 0 || entry.type !== 'Entrada' || !String(entry.description).includes(ownBefore.name))) {
      throw new Error('O extrato de outro clube só pode receber pagamentos do seu clube.');
    }
    if (additions.reduce((sum, entry) => sum + Number(entry.amount), 0) !== budgetChange) {
      throw new Error('O saldo transferido e o extrato do clube destinatário não correspondem.');
    }
    totalBudgetChange += budgetChange;
    positiveTransfers.push(budgetChange);
    return { ...club, budget: Number(submittedClub.budget), ledger: [...club.ledger || [], ...additions] };
  });
  if (totalBudgetChange !== 0) throw new Error('Toda transferência precisa sair de um clube e entrar em outro.');
  if (positiveTransfers.length && ownBudgetChange >= 0) throw new Error('O saldo transferido deve sair do seu clube.');

  const currentPlayers = new Map(current.players.map(player => [player.id, player]));
  const incomingPlayers = new Map(incoming.players.map(player => [player.id, player]));
  const newLoans = incoming.loans.filter(loan => !current.loans.some(existing => existing.id === loan.id));
  const loanPlayerIds = new Set(newLoans.filter(loan => loan.to === ownId).map(loan => loan.playerId));
  const mergedPlayers = [];
  for (const [id, player] of currentPlayers) {
    const updated = incomingPlayers.get(id);
    if (!updated) {
      if (player.clubId !== ownId) mergedPlayers.push(player);
      continue;
    }
    if (player.clubId === ownId) {
      if (updated.clubId !== ownId) throw new Error('Você não pode transferir um atleta para outro clube.');
      mergedPlayers.push(updated);
    } else if (updated.clubId === player.clubId) {
      if (JSON.stringify(updated) !== JSON.stringify(player)) throw new Error('Você só pode editar atletas do seu próprio clube.');
      mergedPlayers.push(player);
    } else if (updated.clubId === ownId && player.listed) {
      const loan = newLoans.find(item => item.playerId === id && item.from === player.clubId && item.to === ownId);
      const seller = next.clubs.find(club => club.id === player.clubId);
      const price = loan ? Number(loan.fee) : Number(player.ask || player.value);
      if (!seller || !Number.isFinite(price) || price < 0) throw new Error('Negociação inválida.');
      mergedPlayers.push({ ...updated, clubId: ownId, listed: false });
      if (loan) {
        const buyer = next.clubs.find(club => club.id === ownId);
        if (buyer.budget < price) throw new Error('Saldo insuficiente para o empréstimo.');
        buyer.budget -= price;
        seller.budget += price;
      }
    } else {
      throw new Error('Só é possível contratar atletas anunciados no mercado.');
    }
  }
  for (const [id, player] of incomingPlayers) {
    if (currentPlayers.has(id)) continue;
    if (player.clubId !== ownId) throw new Error('Você só pode cadastrar atletas no seu próprio clube.');
    mergedPlayers.push(player);
  }
  next.players = mergedPlayers;

  const currentMatches = new Map(current.matches.map(match => [match.id, match]));
  const incomingMatches = new Map(incoming.matches.map(match => [match.id, match]));
  for (const [id, match] of incomingMatches) {
    const previous = currentMatches.get(id);
    if (previous && previous.home !== ownId && previous.away !== ownId && JSON.stringify(previous) !== JSON.stringify(match)) {
      throw new Error('Você só pode editar partidas do seu próprio clube.');
    }
    if (!previous && match.home !== ownId && match.away !== ownId) throw new Error('Você só pode agendar partidas do seu próprio clube.');
    if (match.competition !== ownBefore.competition) throw new Error('A partida precisa pertencer à competição do seu clube.');
  }
  next.matches = current.matches.filter(match => {
    const updated = incomingMatches.get(match.id);
    if (!updated) return match.home !== ownId && match.away !== ownId;
    return match.home !== ownId && match.away !== ownId ? true : false;
  }).concat([...incomingMatches.values()].filter(match => match.home === ownId || match.away === ownId));

  const currentAuctions = new Map(current.auctions.map(auction => [auction.id, auction]));
  const incomingAuctions = new Map(incoming.auctions.map(auction => [auction.id, auction]));
  for (const [id, auction] of incomingAuctions) {
    const previous = currentAuctions.get(id);
    if (!previous && auction.ownerId !== ownId) throw new Error('Você só pode abrir leilões dos seus próprios atletas.');
    if (previous && JSON.stringify(previous) !== JSON.stringify(auction)) {
      if (previous.ownerId !== ownId && auction.bidder !== ownId) throw new Error('Você só pode dar lances nos leilões da sua competição.');
      if (previous.ownerId === ownId && auction.ownerId !== ownId) throw new Error('Leilão inválido.');
    }
  }
  next.auctions = current.auctions.filter(auction => incomingAuctions.has(auction.id)).map(auction => incomingAuctions.get(auction.id));
  for (const auction of incoming.auctions) if (!currentAuctions.has(auction.id) && auction.ownerId === ownId) next.auctions.push(auction);

  const currentLoans = new Map(current.loans.map(loan => [loan.id, loan]));
  const incomingLoans = new Map(incoming.loans.map(loan => [loan.id, loan]));
  for (const loan of incoming.loans) {
    if (!currentLoans.has(loan.id) && loan.to !== ownId) throw new Error('Você só pode receber empréstimos para o seu clube.');
  }
  for (const loan of current.loans) {
    if (!incomingLoans.has(loan.id) && loan.to !== ownId) throw new Error('Você não pode encerrar o empréstimo de outro clube.');
  }
  next.loans = current.loans.filter(loan => incomingLoans.has(loan.id)).map(loan => incomingLoans.get(loan.id));
  next.loans.push(...incoming.loans.filter(loan => !currentLoans.has(loan.id) && loan.to === ownId));

  recalculateStandings(next);
  return next;
}

function validateOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function handleApi(request, response, url) {
  const { pathname } = url;
  const user = activeUser(request);
  if (request.method !== 'GET' && !validateOrigin(request)) return json(response, 403, { error: 'Origem não autorizada.' });

  if (request.method === 'GET' && pathname === '/api/bootstrap') {
    if (!database.users.length) return json(response, 200, { stage: 'setup' });
    if (!user) return json(response, 200, { stage: 'login' });
    return json(response, 200, authPayload(user));
  }

  if (request.method === 'POST' && pathname === '/api/setup') {
    const body = await readJson(request);
    if (database.users.length) return json(response, 409, { error: 'A configuração inicial já foi concluída.' });
    if (!namesAreValid(body.name, body.username, body.password)) return json(response, 400, { error: 'Informe nome, usuário e senha de pelo menos 8 caracteres.' });
    const admin = createUser({ displayName: body.name, username: body.username, password: body.password, role: 'admin' });
    database.users.push(admin);
    database.state = normaliseState(body.initialState);
    database.revision = 1;
    persistDatabase();
    setSession(response, admin);
    return json(response, 201, authPayload(admin));
  }

  if (request.method === 'POST' && pathname === '/api/login') {
    const body = await readJson(request);
    const usernameKey = String(body.username || '').trim().toLowerCase();
    const account = database.users.find(item => item.usernameKey === usernameKey);
    if (!account || !passwordMatches(String(body.password || ''), account)) return json(response, 401, { error: 'Usuário ou senha incorretos.' });
    setSession(response, account);
    return json(response, 200, authPayload(account));
  }

  if (request.method === 'POST' && pathname === '/api/register') {
    const body = await readJson(request);
    const code = String(body.code || '').trim().toUpperCase();
    const inviteHash = hashInvite(code);
    const invite = database.invites.find(item => item.codeHash === inviteHash && !item.usedAt && item.expiresAt > Date.now());
    if (!invite) return json(response, 400, { error: 'Código de convite inválido ou vencido.' });
    if (!namesAreValid(invite.displayName, body.username, body.password)) return json(response, 400, { error: 'Escolha um usuário válido e uma senha de pelo menos 8 caracteres.' });
    if (database.users.some(item => item.usernameKey === body.username.trim().toLowerCase())) return json(response, 409, { error: 'Esse usuário já está em uso.' });
    const club = database.state.clubs.find(item => item.id === invite.clubId);
    if (!club) return json(response, 400, { error: 'O clube do convite não está mais disponível.' });
    const manager = createUser({ displayName: invite.displayName, username: body.username, password: body.password, role: 'manager', clubId: invite.clubId });
    database.users.push(manager);
    invite.usedAt = Date.now();
    club.manager = manager.displayName;
    database.revision++;
    persistDatabase();
    setSession(response, manager);
    return json(response, 201, authPayload(manager));
  }

  if (request.method === 'POST' && pathname === '/api/logout') {
    const token = cookies(request).av_session;
    if (token) sessions.delete(token);
    return json(response, 200, { ok: true }, { 'Set-Cookie': 'av_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (!user) return json(response, 401, { error: 'Entre na sua conta para continuar.' });

  if (request.method === 'GET' && pathname === '/api/managers') {
    if (user.role !== 'admin') return json(response, 403, { error: 'Apenas o administrador pode ver os managers.' });
    const managers = database.users.filter(item => item.role === 'manager').map(item => ({ ...publicUser(item), clubName: database.state.clubs.find(club => club.id === item.clubId)?.name || 'Clube removido' }));
    const invites = database.invites.filter(item => !item.usedAt && item.expiresAt > Date.now()).map(item => ({ id: item.id, displayName: item.displayName, clubId: item.clubId, clubName: database.state.clubs.find(club => club.id === item.clubId)?.name || 'Clube removido', expiresAt: item.expiresAt }));
    return json(response, 200, { managers, invites });
  }

  if (request.method === 'POST' && pathname === '/api/invites') {
    if (user.role !== 'admin') return json(response, 403, { error: 'Apenas o administrador pode convidar managers.' });
    const body = await readJson(request);
    const displayName = String(body.name || '').trim();
    const club = database.state.clubs.find(item => item.id === body.clubId);
    if (displayName.length < 2 || displayName.length > 60 || !club) return json(response, 400, { error: 'Informe o nome do manager e escolha um clube.' });
    if (database.users.some(item => item.role === 'manager' && item.clubId === club.id) || database.invites.some(item => item.clubId === club.id && !item.usedAt && item.expiresAt > Date.now())) {
      return json(response, 409, { error: 'Esse clube já tem um manager ou convite pendente.' });
    }
    const code = randomBytes(5).toString('hex').toUpperCase();
    const invite = { id: `i${randomBytes(8).toString('hex')}`, displayName, clubId: club.id, codeHash: hashInvite(code), createdAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, usedAt: 0 };
    database.invites.push(invite);
    club.manager = displayName;
    database.revision++;
    persistDatabase();
    return json(response, 201, { code, revision: database.revision, invite: { id: invite.id, displayName, clubId: club.id, clubName: club.name, expiresAt: invite.expiresAt } });
  }

  if (request.method === 'DELETE' && pathname.startsWith('/api/invites/')) {
    if (user.role !== 'admin') return json(response, 403, { error: 'Apenas o administrador pode cancelar convites.' });
    const inviteId = pathname.slice('/api/invites/'.length);
    const found = database.invites.some(item => item.id === inviteId && !item.usedAt);
    if (!found) return json(response, 404, { error: 'Convite não encontrado.' });
    const invite = database.invites.find(item => item.id === inviteId);
    database.invites = database.invites.filter(item => item.id !== inviteId);
    const club = database.state.clubs.find(item => item.id === invite.clubId);
    if (club && !database.users.some(item => item.role === 'manager' && item.clubId === club.id)) club.manager = '';
    database.revision++;
    persistDatabase();
    return json(response, 200, { ok: true, revision: database.revision });
  }

  if (request.method === 'PUT' && pathname === '/api/state') {
    const body = await readJson(request);
    if (body.revision !== database.revision) return json(response, 409, { error: 'Outra pessoa atualizou a liga. Recarregue a página para sincronizar antes de continuar.', revision: database.revision });
    if (user.role === 'admin') {
      database.state = normaliseState(body.state);
    } else {
      try {
        database.state = mergeManagerState(user, body.state);
      } catch (error) {
        return json(response, 403, { error: error.message || 'Essa ação não está permitida para o seu perfil.' });
      }
    }
    database.revision++;
    persistDatabase();
    return json(response, 200, { state: stateForUser(user), revision: database.revision });
  }

  return json(response, 404, { error: 'Ação não encontrada.' });
}

const server = createServer(async (request, response) => {
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  } catch {
    return text(response, 400, 'Endereço inválido.');
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(request, response, url);
    } catch (error) {
      json(response, 500, { error: error.message || 'Não foi possível concluir a solicitação.' });
    }
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return text(response, 400, 'Endereço inválido.');
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (relativePath === 'data' || relativePath.startsWith(`data${path.sep}`) || relativePath.startsWith('data/')) return text(response, 403, 'Acesso negado.');
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return text(response, 403, 'Acesso negado.');

  try {
    const contents = readFileSync(filePath);
    const contentType = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(contents);
  } catch {
    text(response, 404, 'Página não encontrada.');
  }
});

function announceAddresses() {
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  console.log(`Vestiário disponível em http://localhost:${activePort}`);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const networkAddress of addresses || []) {
      if (networkAddress.family === 'IPv4' && !networkAddress.internal) console.log(`Acesso na rede local: http://${networkAddress.address}:${activePort}`);
    }
  }
}

server.once('listening', announceAddresses);
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && server.address() === null && server.portFallback !== true) {
    server.portFallback = true;
    console.log(`A porta ${port} já está em uso; tentando ${port + 1}.`);
    server.listen(port + 1, '0.0.0.0');
    return;
  }
  console.error('Não foi possível iniciar o Vestiário:', error.message);
  process.exitCode = 1;
});
server.listen(port, '0.0.0.0');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
