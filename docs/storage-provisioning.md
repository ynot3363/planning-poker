# Planning Poker Storage Provisioning

`PlanningPokerAppData` is a hidden SharePoint document library used as application
infrastructure. Hiding the library reduces normal navigation clutter; it is not
a security boundary, and site administrators can locate it through Site
Contents or SharePoint administration tools.

Provisioning requires the current page author to have SharePoint's Manage Lists
permission. The explicit configuration flow:

1. Finds or creates the `PlanningPokerAppData` document library.
   Creation disables Quick Launch immediately so SharePoint does not add the
   infrastructure library beneath the classic Recent navigation node.
2. Waits for its root folder to become readable.
3. Creates missing metadata fields and records their actual internal names.
4. Breaks permission inheritance while copying existing role assignments.
5. Enumerates SharePoint groups with site-level roles and grants the built-in
   Contribute role to groups whose library role is below Contribute.
6. Preserves Editor, Design, Full Control, and other stronger built-in roles.
7. Resolves the ODSP drive, hides the library from navigation, and returns the
   configuration persisted in the web-part property bag.

Permission repair uses principal IDs and SharePoint's built-in role type rather
than localized group or permission-level names. Retrying configuration checks
the library's current permission scope and role assignments before writing, so
it does not break inheritance repeatedly or duplicate Contribute assignments.

This permission model intentionally lets site Visitors and other site-level
SharePoint groups write collaborative Fluid state in this infrastructure
library. Application host controls are product behavior, not a SharePoint
authorization boundary.

If a participant can open a focused voting link but joining times out while
waiting for a save, verify that the library has unique permissions and that the
participant's SharePoint group has Contribute or stronger access. A page author
with Manage Lists permission can rerun the configuration action to repair an
existing library.
