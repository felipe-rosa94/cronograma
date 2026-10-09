import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const app = initializeApp({
  apiKey: 'AIzaSyDj8m8UDHw67APDb16B82WYZ2TGQebmLf8',
  authDomain: 'cronos-a96ef.firebaseapp.com',
  projectId: 'cronos-a96ef',
  storageBucket: 'cronos-a96ef.firebasestorage.app',
  messagingSenderId: '316549623644',
  appId: '1:316549623644:web:98557a775ac7caeab29b99',
})

export const auth = getAuth(app)
export const db = getFirestore(app)
export const provider = new GoogleAuthProvider()
