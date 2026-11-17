# SchoolDesk Role-Based Access Control (RBAC) Security Specification

## 1. Architectural Roles & Invariants
1. **Director Role**:
   - Sole authority capable of creating staff records, assigning roles (`role`), modifying assigned classes/subjects, and toggling account deactivation (`isActive`).
   - Hardcoded master root: `request.auth.token.email == "patrickpercy1989@gmail.com"`.
2. **Principal Role**:
   - Access to academic supervision, student enrollment, timetable, school reports, and broadsheet oversight.
   - Prohibited from modifying user roles or deactivating staff accounts.
3. **Teacher Role**:
   - Scoped access: May only enter or edit Continuous Assessment (CA) scores and daily attendance for classes or subjects assigned to them in their user profile (`assignedClasses`, `assignedSubjects`).
4. **Parent Role**:
   - Strict ward boundary: May only read student records, attendance, and report sheets belonging to their linked children (`guardianEmail == request.auth.token.email` or student ID in parent's `linkedStudentIds`).
5. **Account & Email Verification Invariant**:
   - Every operation requires `request.auth.token.email_verified == true` and an active `/users/{uid}` document (`isActive == true`).
6. **Parent Academic Approval Gate**:
   - Parents can only read `/academics` records where `isApproved == true` (set exclusively by Principal/Director during `resultReviews` approval) and `/resultReviews` where `status == 'Approved'`.
7. **Anti-Escalation & Anti-Enumeration Invariants**:
   - During user profile updates (`/users/{userId}`), non-directors are strictly blocked from mutating `uid`, `email`, `role`, `isActive`, `assignedClasses`, `assignedSubjects`, or `linkedStudentIds` via `affectedKeys().hasOnly(['displayName', 'phone', 'avatar', 'updatedAt'])`.
   - `/staffInvites` cannot be probed for nonexistent invite IDs (`resource != null`), and `/test/connection` permits single-document `get` only.

## 2. Dirty Dozen Security Tests
1. **Test 1 (Privilege Escalation)**: A teacher attempts to update their own `role` to `'director'` in `/users/{uid}`. (Must fail hasOnly gate).
2. **Test 2 (Deactivation Bypass)**: A deactivated teacher (`isActive: false`) attempts to submit attendance. (Must fail `isActive()` check).
3. **Test 3 (Class Boundary Violation)**: A teacher assigned only to `'JSS 1A'` attempts to upload grades for `'SSS 3 Science'`. (Must fail assignedClasses gate).
4. **Test 4 (Parent Snoop Attack)**: A parent attempts to read another parent's ward record. (Must fail linked ward check).
5. **Test 5 (Principal Account Termination)**: A principal attempts to delete or deactivate a teacher's account. (Must fail `isDirector()` gate).
6. **Test 6 (Anonymous Tampering)**: Unauthenticated request attempting to create a user profile. (Must fail `isSignedIn()`).
7. **Test 7 (ID Poisoning)**: Document path variable injection with malicious characters. (Must fail `isValidId()`).
8. **Test 8 (Ghost Field Injection)**: Inserting hidden `isAdmin: true` into a student record. (Must fail `isValidStudent()`).
9. **Test 9 (Self-Role Assignment on Register)**: A newly signed-up user sets their initial role to `'director'`. (Must default or require Director approval).
10. **Test 10 (Direct Fee Modification)**: A teacher attempting to alter school fee balances. (Must fail finance gate).
11. **Test 11 (Settings Hijack)**: Non-director user modifying official school bank accounts or currency symbol. (Must fail `isDirector()`).
12. **Test 12 (Blanket Query Scraping)**: Reading all users without Director privilege. (Must fail `isDirector()` list gate).
