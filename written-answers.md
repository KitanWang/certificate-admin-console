# Written technical answers

Completed by the candidate without AI assistance, per Section 6 of the brief.

## Question 1

During rolling deployment, old application instances need to access display_name, but database no longer contains this column, this causes error and data loss. More reliable way is just add new column full_name to the table, and let transition application write both two fields. Then copy data of display_name to full_name, to make sure there is no NULL in full_name. Now we can release new application which have no access to display_name and wait all old instances stop, then delete column of display_name.

## Question 2

Decease TTL to 5 seconds just shorten lifetime of wrong data. I will add version number in the cache entry. When B revokes, it increments the version number in cache. so that data of old version (from A) cannot renew data with a newer version number.

## Question 3
