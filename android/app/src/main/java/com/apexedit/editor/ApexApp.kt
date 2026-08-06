package com.apexedit.editor

import android.app.Application

/**
 * Application entry point.
 *
 * Deliberately empty of initialisation: there is no analytics SDK, no crash
 * reporter and no network client to start, because this build talks to nothing.
 */
class ApexApp : Application()
