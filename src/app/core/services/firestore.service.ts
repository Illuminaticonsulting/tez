import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  query,
  where,
  orderBy,
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
} from '@angular/fire/firestore';
import { Observable, Subject, takeUntil, map, filter } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private firestore = inject(Firestore);

  // ---- Read ----
  getDocument<T>(path: string): Observable<T> {
    const ref = doc(this.firestore, path) as DocumentReference<T>;
    return docData(ref, { idField: 'id' as any }).pipe(
      filter((v): v is T => v !== undefined)
    );
  }

  getCollection<T>(
    path: string,
    constraints: QueryConstraint[] = []
  ): Observable<T[]> {
    const ref = collection(this.firestore, path) as CollectionReference<T>;
    const q = constraints.length ? query(ref, ...constraints) : ref;
    return collectionData(q as any, { idField: 'id' as any }) as Observable<T[]>;
  }

  /** Real-time listener returning an unsubscribe function */
  listenToCollection<T>(
    path: string,
    constraints: QueryConstraint[],
    callback: (data: T[]) => void
  ): () => void {
    const ref = collection(this.firestore, path) as CollectionReference<T>;
    const q = query(ref, ...constraints);
    return onSnapshot(q as any, (snapshot: any) => {
      const docs = snapshot.docs.map((d: any) => ({
        id: d.id,
        ...d.data(),
      })) as T[];
      callback(docs);
    });
  }

  // ---- Write (prefer Cloud Functions for mutations) ----
  async addDocument<T extends Record<string, any>>(
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
    data: Record<string, any>
  ): Promise<void> {
    const ref = doc(this.firestore, path);
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  }

  async deleteDocument(path: string): Promise<void> {
    const ref = doc(this.firestore, path);
    await deleteDoc(ref);
  }

  // ---- Transactions (atomic operations) ----
  async runTransaction<T>(
    updateFn: (transaction: any) => Promise<T>
  ): Promise<T> {
    return runTransaction(this.firestore, updateFn);
  }

  // ---- Batch writes ----
  createBatch() {
    return writeBatch(this.firestore);
  }

  // ---- Helpers ----
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
