export default function WatchlistHeart({ filled = false }: { filled?: boolean }) {
  return (
    <svg className="heart-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3A6 6 0 0 1 12 5.09 6 6 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
