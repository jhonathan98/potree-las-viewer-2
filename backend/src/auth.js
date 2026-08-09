import { jwtVerify, createRemoteJWKSet } from 'jose';

// Los proyectos nuevos de Supabase firman los JWT de Auth con una clave
// asimetrica (ES256) en vez del JWT Secret compartido clasico (HS256), asi
// que validamos contra el JWKS publico del proyecto en vez de un secreto
// estatico. jose cachea el JWKS automaticamente.
const JWKS = createRemoteJWKSet(
  new URL('/auth/v1/.well-known/jwks.json', process.env.SUPABASE_URL)
);

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Falta token de autenticacion' });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${process.env.SUPABASE_URL}/auth/v1`,
    });
    req.userId = payload.sub;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token invalido o expirado' });
  }
}
