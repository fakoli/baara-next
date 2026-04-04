export default function Chat() {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-10 py-12 text-center max-w-sm">
        <div className="mx-auto w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
          <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900">Chat integration coming soon</h2>
        <p className="text-sm text-gray-400 mt-2">
          Conversational control of your agent tasks will be available in a future release.
        </p>
      </div>
    </div>
  );
}
