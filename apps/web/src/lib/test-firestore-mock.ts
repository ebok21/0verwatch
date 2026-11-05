/**
 * Isolated In-Memory Firestore Mock for Test Isolation
 * Ensures unit and integration tests cannot accidentally touch or pollute the cloud Firebase project.
 */

export class MockDocumentSnapshot {
  constructor(
    public readonly id: string,
    private readonly _data: Record<string, unknown> | undefined,
    public readonly ref: MockDocumentReference
  ) {}

  public get exists(): boolean {
    return this._data !== undefined;
  }

  public data(): Record<string, unknown> | undefined {
    if (this._data === undefined) return undefined;
    return JSON.parse(JSON.stringify(this._data));
  }
}

export class MockQuery {
  constructor(
    protected readonly store: InMemoryFirestoreStore,
    protected readonly collectionPath: string,
    protected readonly filters: Array<{ field: string; op: string; val: unknown }> = [],
    protected readonly orderBys: Array<{ field: string; dir: "asc" | "desc" }> = [],
    protected readonly limitVal: number | null = null
  ) {}

  public where(field: string, op: string, val: unknown): MockQuery {
    return new MockQuery(
      this.store,
      this.collectionPath,
      [...this.filters, { field, op, val }],
      this.orderBys,
      this.limitVal
    );
  }

  public orderBy(field: string, dir: "asc" | "desc" = "asc"): MockQuery {
    return new MockQuery(
      this.store,
      this.collectionPath,
      this.filters,
      [...this.orderBys, { field, dir }],
      this.limitVal
    );
  }

  public limit(n: number): MockQuery {
    return new MockQuery(
      this.store,
      this.collectionPath,
      this.filters,
      this.orderBys,
      n
    );
  }

  public async get(): Promise<{
    empty: boolean;
    size: number;
    docs: MockDocumentSnapshot[];
  }> {
    const rawDocs = this.store.getCollectionDocs(this.collectionPath);
    let matched = rawDocs.filter((doc) => {
      for (const filter of this.filters) {
        const val = doc.data[filter.field];
        if (filter.op === "==" && val !== filter.val) return false;
        if (filter.op === "!=" && val === filter.val) return false;
        if (filter.op === ">" && !(Number(val) > Number(filter.val))) return false;
        if (filter.op === ">=" && !(Number(val) >= Number(filter.val))) return false;
        if (filter.op === "<" && !(Number(val) < Number(filter.val))) return false;
        if (filter.op === "<=" && !(Number(val) <= Number(filter.val))) return false;
      }
      return true;
    });

    for (const ob of this.orderBys) {
      matched.sort((a, b) => {
        const aVal = a.data[ob.field];
        const bVal = b.data[ob.field];
        const aStr = String(aVal ?? "");
        const bStr = String(bVal ?? "");
        const cmp = aStr.localeCompare(bStr);
        return ob.dir === "desc" ? -cmp : cmp;
      });
    }

    if (this.limitVal !== null && this.limitVal >= 0) {
      matched = matched.slice(0, this.limitVal);
    }

    const docs = matched.map(
      (d) =>
        new MockDocumentSnapshot(
          d.id,
          d.data,
          new MockDocumentReference(this.store, this.collectionPath, d.id)
        )
    );

    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
    };
  }
}

export class MockCollectionReference extends MockQuery {
  public readonly id: string;

  constructor(store: InMemoryFirestoreStore, public readonly path: string) {
    super(store, path);
    const parts = path.split("/");
    this.id = parts[parts.length - 1] ?? path;
  }

  public doc(docId?: string): MockDocumentReference {
    const finalId = docId || `auto-id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new MockDocumentReference(this.store, this.path, finalId);
  }
}

export class MockDocumentReference {
  public readonly path: string;

  constructor(
    private readonly store: InMemoryFirestoreStore,
    public readonly collectionPath: string,
    public readonly id: string
  ) {
    this.path = `${collectionPath}/${id}`;
  }

  public async get(): Promise<MockDocumentSnapshot> {
    const raw = this.store.getDoc(this.collectionPath, this.id);
    return new MockDocumentSnapshot(this.id, raw, this);
  }

  public async set(
    data: Record<string, unknown>,
    options?: { merge?: boolean }
  ): Promise<void> {
    this.store.setDoc(this.collectionPath, this.id, data, options?.merge);
  }

  public async update(data: Record<string, unknown>): Promise<void> {
    this.store.setDoc(this.collectionPath, this.id, data, true);
  }

  public async delete(): Promise<void> {
    this.store.deleteDoc(this.collectionPath, this.id);
  }

  public collection(subCollectionName: string): MockCollectionReference {
    return new MockCollectionReference(
      this.store,
      `${this.collectionPath}/${this.id}/${subCollectionName}`
    );
  }
}

export class MockWriteBatch {
  private operations: Array<() => void> = [];

  constructor(private readonly store: InMemoryFirestoreStore) {}

  public set(
    docRef: MockDocumentReference,
    data: Record<string, unknown>,
    options?: { merge?: boolean }
  ): this {
    this.operations.push(() => {
      this.store.setDoc(docRef.collectionPath, docRef.id, data, options?.merge);
    });
    return this;
  }

  public update(
    docRef: MockDocumentReference,
    data: Record<string, unknown>
  ): this {
    this.operations.push(() => {
      this.store.setDoc(docRef.collectionPath, docRef.id, data, true);
    });
    return this;
  }

  public delete(docRef: MockDocumentReference): this {
    this.operations.push(() => {
      this.store.deleteDoc(docRef.collectionPath, docRef.id);
    });
    return this;
  }

  public async commit(): Promise<void> {
    for (const op of this.operations) {
      op();
    }
    this.operations = [];
  }
}

export class InMemoryFirestoreStore {
  private collections = new Map<string, Map<string, Record<string, unknown>>>();

  public getDoc(col: string, id: string): Record<string, unknown> | undefined {
    const c = this.collections.get(col);
    if (!c) return undefined;
    const item = c.get(id);
    if (!item) return undefined;
    return JSON.parse(JSON.stringify(item));
  }

  public setDoc(
    col: string,
    id: string,
    data: Record<string, unknown>,
    merge = false
  ): void {
    let c = this.collections.get(col);
    if (!c) {
      c = new Map();
      this.collections.set(col, c);
    }
    const cleanData = JSON.parse(JSON.stringify(data));
    if (merge && c.has(id)) {
      c.set(id, { ...c.get(id)!, ...cleanData });
    } else {
      c.set(id, cleanData);
    }
  }

  public deleteDoc(col: string, id: string): void {
    const c = this.collections.get(col);
    if (c) {
      c.delete(id);
    }
  }

  public getCollectionDocs(col: string): Array<{ id: string; data: Record<string, unknown> }> {
    const c = this.collections.get(col);
    if (!c) return [];
    return Array.from(c.entries()).map(([id, data]) => ({
      id,
      data: JSON.parse(JSON.stringify(data)),
    }));
  }

  public clear(): void {
    this.collections.clear();
  }
}

export class IsolatedInMemoryFirestore {
  private store = new InMemoryFirestoreStore();

  public collection(name: string): MockCollectionReference {
    return new MockCollectionReference(this.store, name);
  }

  public batch(): MockWriteBatch {
    return new MockWriteBatch(this.store);
  }

  public async runTransaction<T>(
    updateFunction: (tx: {
      get: (ref: MockDocumentReference) => Promise<MockDocumentSnapshot>;
      set: (
        ref: MockDocumentReference,
        data: Record<string, unknown>,
        opts?: { merge?: boolean }
      ) => void;
      delete: (ref: MockDocumentReference) => void;
    }) => Promise<T>
  ): Promise<T> {
    const batchOps: Array<() => void> = [];
    const tx = {
      get: async (ref: MockDocumentReference) => ref.get(),
      set: (
        ref: MockDocumentReference,
        data: Record<string, unknown>,
        opts?: { merge?: boolean }
      ) => {
        batchOps.push(() =>
          this.store.setDoc(ref.collectionPath, ref.id, data, opts?.merge)
        );
      },
      delete: (ref: MockDocumentReference) => {
        batchOps.push(() => this.store.deleteDoc(ref.collectionPath, ref.id));
      },
    };

    const result = await updateFunction(tx);
    for (const op of batchOps) {
      op();
    }
    return result;
  }

  public settings(_options: Record<string, unknown>): void {
    // no-op for in-memory mock
  }

  public clear(): void {
    this.store.clear();
  }
}

let isolatedInstance: IsolatedInMemoryFirestore | null = null;

export function getIsolatedInMemoryFirestore(): IsolatedInMemoryFirestore {
  if (!isolatedInstance) {
    isolatedInstance = new IsolatedInMemoryFirestore();
  }
  return isolatedInstance;
}

export function resetIsolatedInMemoryFirestore(): void {
  if (isolatedInstance) {
    isolatedInstance.clear();
  }
}

