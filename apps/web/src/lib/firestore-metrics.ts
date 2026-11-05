export interface FirestoreMetrics {
  reads: number;
  writes: number;
  queries: number;
  lastOperationAt: string | null;
}

const metrics: FirestoreMetrics = {
  reads: 0,
  writes: 0,
  queries: 0,
  lastOperationAt: null,
};

export function getFirestoreMetrics(): Readonly<FirestoreMetrics> {
  return { ...metrics };
}

export function resetFirestoreMetrics(): void {
  metrics.reads = 0;
  metrics.writes = 0;
  metrics.queries = 0;
  metrics.lastOperationAt = null;
}

export function trackFirestoreRead(count = 1): void {
  metrics.reads += count;
  metrics.lastOperationAt = new Date().toISOString();
}

export function trackFirestoreWrite(count = 1): void {
  metrics.writes += count;
  metrics.lastOperationAt = new Date().toISOString();
}

export function trackFirestoreQuery(returnedDocsCount = 0): void {
  metrics.queries += 1;
  metrics.reads += returnedDocsCount;
  metrics.lastOperationAt = new Date().toISOString();
}

export function instrumentFirestoreInstance<T extends object>(firestore: T): T {
  function wrapDocRef(docRef: any, path: string): any {
    return new Proxy(docRef, {
      get(target, prop, receiver) {
        if (prop === "get") {
          return async (...args: any[]) => {
            trackFirestoreRead(1);
            return target.get(...args);
          };
        }
        if (prop === "set" || prop === "update" || prop === "delete") {
          return async (...args: any[]) => {
            trackFirestoreWrite(1);
            return target[prop](...args);
          };
        }
        if (prop === "collection") {
          return (subName: string) =>
            wrapColRef(target.collection(subName), `${path}/${subName}`);
        }
        const val = Reflect.get(target, prop, receiver);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
  }

  function wrapColRef(colOrQuery: any, path: string): any {
    return new Proxy(colOrQuery, {
      get(target, prop, receiver) {
        if (prop === "get") {
          return async (...args: any[]) => {
            const snap = await target.get(...args);
            const count = snap.docs ? snap.docs.length : 1;
            trackFirestoreQuery(count);
            return snap;
          };
        }
        if (
          prop === "where" ||
          prop === "orderBy" ||
          prop === "limit" ||
          prop === "startAfter" ||
          prop === "select" ||
          prop === "startAt" ||
          prop === "endAt" ||
          prop === "endBefore"
        ) {
          return (...args: any[]) => wrapColRef(target[prop](...args), path);
        }
        if (prop === "doc") {
          return (docId?: string) => {
            const childDoc = docId ? target.doc(docId) : target.doc();
            return wrapDocRef(childDoc, `${path}/${docId || "auto"}`);
          };
        }
        const val = Reflect.get(target, prop, receiver);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
  }

  return new Proxy(firestore, {
    get(target: any, prop, receiver) {
      if (prop === "collection") {
        return (colName: string) =>
          wrapColRef(target.collection(colName), colName);
      }
      if (prop === "runTransaction") {
        return async (updateFunction: any, transactionOptions?: any) => {
          return target.runTransaction(async (tx: any) => {
            const wrappedTx = new Proxy(tx, {
              get(tTarget, tProp, tReceiver) {
                if (tProp === "get") {
                  return async (...args: any[]) => {
                    trackFirestoreRead(1);
                    return tTarget.get(...args);
                  };
                }
                if (
                  tProp === "set" ||
                  tProp === "update" ||
                  tProp === "delete"
                ) {
                  return (...args: any[]) => {
                    trackFirestoreWrite(1);
                    return tTarget[tProp](...args);
                  };
                }
                const val = Reflect.get(tTarget, tProp, tReceiver);
                return typeof val === "function" ? val.bind(tTarget) : val;
              },
            });
            return updateFunction(wrappedTx);
          }, transactionOptions);
        };
      }
      if (prop === "batch") {
        return () => {
          const b = target.batch();
          let batchWrites = 0;
          return new Proxy(b, {
            get(bTarget, bProp, bReceiver) {
              if (
                bProp === "set" ||
                bProp === "update" ||
                bProp === "delete"
              ) {
                return (...args: any[]) => {
                  batchWrites += 1;
                  return bTarget[bProp](...args);
                };
              }
              if (bProp === "commit") {
                return async (...args: any[]) => {
                  trackFirestoreWrite(batchWrites);
                  return bTarget.commit(...args);
                };
              }
              const val = Reflect.get(bTarget, bProp, bReceiver);
              return typeof val === "function" ? val.bind(bTarget) : val;
            },
          });
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}
