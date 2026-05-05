module.exports = (req, res) => {
  // Support both Node serverless (`req, res`) and Edge/Fetch (`Request` -> return Response)
  try {
    if (res && typeof res.status === 'function') {
      return res.status(200).send('OK');
    }
  } catch (e) {
    // fallthrough to Response
  }

  // Edge runtime: `req` is a Request object
  return new Response('OK', { status: 200 });
};
