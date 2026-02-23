import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  query,
  updateDoc,
  addDoc,
  deleteDoc,
  runTransaction,
  writeBatch,
  onSnapshot,
  DocumentReference,
  CollectionReference,
  QueryConstraint,
  serverTimestamp,
  QuerySnapshot,
  DocumentData,
} from '@angular/fire/firestore';
import { Observable, filter } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private firestore = inject(Firestore);

  // ---- Read ----
  getDocument<T extends DocumentData>(path: string): Observable<T> {
    const ref = doc(this.firestore, path) as DocumentReference<T>;
    return (docData(ref, { idField: 'id' as never }) as Observable<T | undefined>).pipe(
      filter((v): v is T => v !== undefined)
    );
  }

  getCollection<T extends DocumentData>(
    path: string,
    constraints: QueryConstraint[] = []
  ): Observable<T[]> {
    const colRef = collection(this.firestore, path) as CollectionReference<T>;
    const q = constraints.length ? query(colRef, ...constraints) : colRef;
    return collectionData(q, { idField: 'id' as never }) as unknown as Observable<T[]>;
  }

  /** Real-time listener returning an unsubscribe function */
  listenToCollection<T extends DocumentData>(
    path: string,
    constraints: QueryConstraint[],
    callback: (data: T[]) => void
  ): () => void {
    const colRef = collection(this.firestore, path) as CollectionReference<T>;
    const q = query(colRef, ...constraints);

    return onSnapshot(q, (snapshot: QuerySnapshot<T>) => {
      const docs = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      } as unknown as T));
      callback(docs);
    });
  }

  // ---- Write (prefer Cloud Functions for mutations) ----
  async addDocument<T extends Record<string, unknown>>(
    path: string,
    data: T
  ): Promise<string> {
    const ref = collection(this.firestore, path);
    const docRef = await addDoc(ref, {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  }

  async updateDocument(
    path: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const ref = doc(this.firestore, path);
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  }

  async deleteDocument(path: string): Promise<void> {
    const ref = doc(this.firestore, path);
    await deleteDoc(ref);
  }

  // ---- Transactions ----
  async runTransaction<T>(
    updateFn: (transaction: Parameters<Parameters<typeof runTransaction>[1]>[0]) => Promise<T>
  ): Promise<T> {
    return runTransaction(this.firestore, updateFn);
  }

  createBatch() {
    return writeBatch(this.firestore);
  }

  docRef(path: string) {
    return doc(this.firestore, path);
  }

  collectionRef(path: string) {
    return collection(this.firestore, path);
  }

  get serverTimestamp() {
    return serverTimestamp();
  }
}
