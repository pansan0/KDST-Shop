// Minimal express-session store backed by the app's SQLite database.
module.exports = session => {
  class SqliteStore extends session.Store {
    constructor(db) {
      super();
      this.db = db;
      this.getQ = db.prepare('SELECT sess FROM sessions WHERE sid=? AND expires>?');
      this.setQ = db.prepare('INSERT INTO sessions(sid,sess,expires) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires=excluded.expires');
      this.delQ = db.prepare('DELETE FROM sessions WHERE sid=?');
      setInterval(() => db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now()), 3600e3).unref();
    }
    get(sid, cb) {
      try { const r = this.getQ.get(sid, Date.now()); cb(null, r ? JSON.parse(r.sess) : null); } catch (e) { cb(e); }
    }
    set(sid, sess, cb) {
      try {
        const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 864e5;
        this.setQ.run(sid, JSON.stringify(sess), exp); cb && cb(null);
      } catch (e) { cb && cb(e); }
    }
    destroy(sid, cb) { try { this.delQ.run(sid); cb && cb(null); } catch (e) { cb && cb(e); } }
    touch(sid, sess, cb) { this.set(sid, sess, cb); }
  }
  return SqliteStore;
};
