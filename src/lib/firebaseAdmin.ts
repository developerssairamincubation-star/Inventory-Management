import * as admin from 'firebase-admin'

function getFirebaseAdmin(): admin.app.App {
  if (admin.apps.length > 0) return admin.apps[0]!

  const projectId     = process.env.FIREBASE_PROJECT_ID
  const clientEmail   = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey    = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase Admin env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY'
    )
  }

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  })
}

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
  const app = getFirebaseAdmin()
  return admin.auth(app).verifyIdToken(token)
}

export async function createFirebaseUser(email: string, password: string, displayName: string) {
  const app = getFirebaseAdmin()
  return admin.auth(app).createUser({ email, password, displayName })
}

export async function deleteFirebaseUser(uid: string) {
  const app = getFirebaseAdmin()
  return admin.auth(app).deleteUser(uid)
}

export async function updateFirebaseUser(uid: string, data: admin.auth.UpdateRequest) {
  const app = getFirebaseAdmin()
  return admin.auth(app).updateUser(uid, data)
}
