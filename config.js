// Optional Google Maps key injection point.
//
// - Public / shared hosting: leave this empty. Visitors paste their own key
//   in the app (stored only in their browser's localStorage), or pass it once
//   as ?gmapsKey=YOUR_KEY in the URL.
// - Self-hosted build with your own key: set it below AND restrict the key by
//   HTTP referrer in Google Cloud so it only works on your domain.
window.GMAPS_KEY = window.GMAPS_KEY || '';
