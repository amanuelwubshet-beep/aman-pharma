function authMiddleware(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'No user id provided' });
  }
  req.userId = parseInt(userId, 10);
  next();
}

module.exports = authMiddleware;