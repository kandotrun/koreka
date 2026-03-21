export const fetcher = (url: string) => fetch(url).then(res => res.json());

export const authFetcher = (url: string, token: string) =>
  fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(res => {
    if (res.status === 401) throw new Error('Unauthorized');
    return res.json();
  });
