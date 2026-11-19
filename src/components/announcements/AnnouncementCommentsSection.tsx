import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Send,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AnnouncementComment, UserRole } from '../../types';
import {
  addAnnouncementCommentToFirestore,
  deleteAnnouncementCommentFromFirestore,
  subscribeAnnouncementComments,
} from '../../services/communicationService';
import { extractFriendlyError } from '../../services/schoolService';

interface AnnouncementCommentsSectionProps {
  announcementId: string;
  canModerate?: boolean;
  defaultExpanded?: boolean;
}

const ROLE_LABELS: Record<UserRole, string> = {
  director: 'Director',
  principal: 'Principal',
  head_teacher: 'Head Teacher',
  bursar: 'Bursar',
  teacher: 'Teacher',
  parent: 'Parent',
};

function formatCommentTimestamp(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const AnnouncementCommentsSection: React.FC<AnnouncementCommentsSectionProps> = ({
  announcementId,
  canModerate = false,
  defaultExpanded = false,
}) => {
  const { firebaseUser, currentUser, role } = useAuth();
  const [comments, setComments] = useState<AnnouncementComment[]>([]);
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const [commentText, setCommentText] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!firebaseUser || !announcementId) {
      setComments([]);
      return;
    }

    const unsub = subscribeAnnouncementComments(
      announcementId,
      (list) => {
        setComments(list);
      },
      (err) => {
        setErrorMsg(err);
      }
    );
    return () => unsub();
  }, [firebaseUser, announcementId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      setErrorMsg('Please sign in to post a comment.');
      return;
    }
    const trimmed = commentText.trim();
    if (!trimmed) {
      setErrorMsg('Please enter a comment before posting.');
      return;
    }

    setErrorMsg('');
    setIsSubmitting(true);
    try {
      const displayName =
        currentUser?.displayName ||
        firebaseUser.displayName ||
        firebaseUser.email?.split('@')[0] ||
        (role === 'parent' ? 'Parent' : 'Staff');

      await addAnnouncementCommentToFirestore({
        announcementId,
        authorUid: firebaseUser.uid,
        authorName: displayName,
        authorRole: role,
        body: trimmed,
      });
      setCommentText('');
      setIsExpanded(true);
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to post your comment.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!canModerate) return;
    setErrorMsg('');
    setDeletingId(commentId);
    try {
      await deleteAnnouncementCommentFromFirestore(announcementId, commentId);
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to delete comment.'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mt-4 pt-3 border-t border-[#EFE9DF]">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B1020] hover:text-[#540C19] transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>
            Comments ({comments.length})
          </span>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>

        {!isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="text-[11px] font-medium text-[#5E5B56] hover:text-[#6B1020] underline-offset-2 hover:underline"
          >
            {comments.length === 0 ? 'Add a comment' : 'View & reply'}
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="mt-3 space-y-3">
          {errorMsg && (
            <div className="p-2.5 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-xs text-[#86222E] flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {comments.length === 0 ? (
            <p className="text-[11px] text-[#7F7A72] bg-[#FAF8F4] border border-[#EFE9DF] rounded-[8px] px-3 py-2.5">
              No comments yet. Be the first to leave a question or comment on this announcement.
            </p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {comments.map((cmt) => {
                const isParentAuthor = cmt.authorRole === 'parent';
                return (
                  <div
                    key={cmt.id}
                    className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-[#2A2A2E]">
                          {cmt.authorName}
                        </span>
                        <span
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-[5px] border ${
                            isParentAuthor
                              ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                              : 'bg-[#FAF0F2] text-[#6B1020] border-[#DFC7CA]'
                          }`}
                        >
                          {ROLE_LABELS[cmt.authorRole] || cmt.authorRole}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#7F7A72] tabular-nums">
                          {formatCommentTimestamp(cmt.createdAt)}
                        </span>
                        {canModerate && (
                          <button
                            type="button"
                            disabled={deletingId === cmt.id}
                            onClick={() => handleDelete(cmt.id)}
                            title="Delete comment"
                            className="p-1 rounded-[6px] text-[#86222E] hover:bg-[#FAF0F2] transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-[#2A2A2E] leading-relaxed whitespace-pre-line">
                      {cmt.body}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {firebaseUser && (
            <form onSubmit={handleSubmit} className="space-y-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a comment or question about this announcement..."
                  className="flex-1 px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] placeholder:text-[#7F7A72] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none resize-y"
                />
                <button
                  type="submit"
                  disabled={isSubmitting || !commentText.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] disabled:opacity-50 text-white text-xs font-medium transition-colors shrink-0 sm:self-end"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isSubmitting ? 'Posting...' : 'Post Comment'}
                </button>
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#7F7A72]">
                <span>Comments are visible to school staff and other parents viewing this notice.</span>
                <span className="tabular-nums">{commentText.length}/1000</span>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
