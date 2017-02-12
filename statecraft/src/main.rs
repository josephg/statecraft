#![allow(unused_variables)]
#![allow(dead_code)]
#![allow(unused_imports)]

extern crate futures;
use futures::{future, Future};

use std::borrow::Cow;
use std::rc::Rc;
use std::collections::HashMap;

type Version = u64;
type Bytes = Rc<Box<[u8]>>;
type Source = Bytes; //Vec<u8>;

fn _vs(s: &str) -> Bytes { Rc::new(s.as_bytes().to_vec().into_boxed_slice()) }

type VersionRanges = HashMap<Source, (Version, Version)>;

#[derive(Debug)]
pub enum ConflictReason {
    InvalidOp, // ?? We can be more descriptive than this.
    TxnTooOld,
}

#[derive(Debug)]
pub enum SCError {
    VersionTooOld,
    VersionInFuture,
    WriteConflict(ConflictReason), // TODO: Add conflict reason.
}

#[derive(Debug, Clone, PartialEq)]
enum Op {
    Ins(Bytes),
    Set(Bytes),
    Rm,
    Inc(u64),
}

fn apply_one(data: Option<Bytes>, op: &Op) -> Option<Bytes> {
    use Op::*;
    match op {
        &Ins(ref i) => Some(i.clone()), // ?? And check if the data is empty?
        &Set(ref i) => Some(i.clone()),
        &Rm => None,
        &Inc(num) => unimplemented!(),
    }
}

struct MutateOpts {}

struct SubscriptionOpts {
    supported_types: (),
    raw: bool,
}

struct Subscription<QueryType> {
    query: QueryType,
    data: Option<HashMap<Bytes, Bytes>>, // Only if subscription is not raw.
    opts: SubscriptionOpts,
    versions: HashMap<Source, Version>,
}

impl<QueryType> Subscription<QueryType> {
    fn cancel(self) {}
}

#[derive(Debug)]
struct FetchResults {
    data: HashMap<Bytes, Bytes>,
    versions: VersionRanges,
}

trait Store {
    type Query;

    fn mutate(&mut self, txn: HashMap<Bytes, Op>, versions: HashMap<Source, Version>, options: MutateOpts)
        -> Box<Future<Item = (), Error = SCError>>;

    fn fetch(&self, query: Self::Query, versions: HashMap<Source, (Version, Version)>)
        -> Box<Future<Item = FetchResults, Error = SCError>>;

    fn subscribe(&self, query: Self::Query, versions: HashMap<Source, Version>, opts: SubscriptionOpts)
        -> Subscription<Vec<Bytes>>;
}

#[derive(Debug)]
struct DbCell {
    val: Option<Bytes>,
    last_mod: Version,
}

struct Db {
    source: Source,
    version: Version,

    data: HashMap<Bytes, DbCell>,
}

impl Db {
    fn new() -> Db {
        Db {
            source: _vs("SOURCE"),
            version: 0,
            data: HashMap::new(),
        }
    }
    /*
    fn get_version(&self, key: &[u8]) -> Version {
        self.data.get(key).map(|ref cell| cell.last_mod).unwrap_or(0)
    }*/
}

impl Store for Db {
    type Query = Vec<Bytes>;

    fn mutate(&mut self, txn: HashMap<Bytes, Op>, versions: HashMap<Source, Version>, options: MutateOpts)
            -> Box<Future<Item = (), Error = SCError>> {

        let txn_v = versions.get(&self.source);

        // 1: Check the transaction is valid. We can't back it out halfway through, later.

        for (key, op) in &txn {
            let cell = self.data.get(key);

            // If the cell is empty you must insert.
            if !match cell {
                Some(_) => match op { &Op::Ins(_) => false, _ => true },
                // Should we allow Set when there's no data?
                None => match op { &Op::Ins(_) => true, &Op::Set(_) => true, _ => false },
            } {
                //println!("conflict {:?} {:?}, cell {:?}", key, op, cell);
                return Box::new(future::err(SCError::WriteConflict(ConflictReason::InvalidOp)));
            }

            if let Some(cell) = cell { if let Some(&txn_v) = txn_v {
                if cell.last_mod > txn_v {
                    return Box::new(future::err(SCError::WriteConflict(ConflictReason::TxnTooOld)));
                }
            } }
        }


        // **** Ok, transaction going ahead!
        self.version += 1;

        for (key, op) in &txn {
            if let Some(cell) = self.data.get_mut(key) {
                cell.val = apply_one(cell.val.take(), op);
                cell.last_mod = self.version;
                continue; // Written without an else for scoping reasons.
            }

            let cell = DbCell {
                val: apply_one(None, op),
                last_mod: self.version,
            };
            self.data.insert(key.clone(), cell);
        }

        Box::new(future::ok(()))
    }

    fn fetch(&self, query: Self::Query, versions: HashMap<Source, (Version, Version)>)
            -> Box<Future<Item = FetchResults, Error = SCError>> {
        if let Some(&(minv, maxv)) = versions.get(&self.source) {
            // TODO: Add option to hold query until specified version.
            if minv > self.version { return Box::new(future::err(SCError::VersionInFuture)); }

            // TODO: Add operation cache.
            if maxv < self.version { return Box::new(future::err(SCError::VersionTooOld)); }
        }

        let mut result = HashMap::<Bytes, Bytes>::new();
        let mut min_version: Version = 0;

        for ref k in query {
            if let Some(cell) = self.data.get(k) {
                if let Some(val) = cell.val.as_ref() { result.insert(k.clone(), val.clone()); }
                if min_version < cell.last_mod { min_version = cell.last_mod; }
            }
        }

        let mut result_versions = HashMap::new();
        result_versions.insert(self.source.clone(), (min_version, self.version));
        Box::new(future::ok(FetchResults {
            data: result,
            versions: result_versions,
        }))
    }

    fn subscribe(&self, query: Self::Query, versions: HashMap<Source, Version>, opts: SubscriptionOpts)
            -> Subscription<Vec<Bytes>> {
        unimplemented!()
    }
}


fn dbset<DB: Store<Query = Vec<Bytes>>>(db: &mut DB, key: Bytes, val: Bytes) -> Result<(), SCError> {
    let mut txn = HashMap::new();
    txn.insert(key, Op::Set(val)); // Ins??
    db.mutate(txn, HashMap::new(), MutateOpts {}).wait()
}

fn main() {
    let mut db = Db::new();

    let result = db.fetch(vec![_vs("a")], HashMap::new()).wait();
    println!("{:?}", result);

    dbset(&mut db, _vs("a"), _vs("1")).unwrap();
    dbset(&mut db, _vs("b"), _vs("2")).unwrap();
    dbset(&mut db, _vs("c"), _vs("3")).unwrap();

    let result = db.fetch(vec![_vs("a"), _vs("b")], HashMap::new()).wait();
    println!("{:?}", result);
}
