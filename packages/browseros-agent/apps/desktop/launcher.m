#import <AppKit/AppKit.h>

static void fail(NSString *message) {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"AI Browser could not start";
    alert.informativeText = message;
    alert.alertStyle = NSAlertStyleCritical;
    [alert addButtonWithTitle:@"OK"];
    [NSApp activateIgnoringOtherApps:YES];
    [alert runModal];
    exit(1);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        NSBundle *bundle = NSBundle.mainBundle;
        NSURL *resources = bundle.resourceURL;
        NSString *origin = [bundle objectForInfoDictionaryKey:@"ResearchOrigin"];
        if (!resources || ![[NSURL URLWithString:origin].scheme isEqualToString:@"https"]) {
            fail(@"The application package is incomplete. Rebuild or reinstall AI Browser.");
        }
        NSURL *browser = [resources URLByAppendingPathComponent:@"BrowserOS.app"];
        NSString *extension = [resources URLByAppendingPathComponent:@"extension"].path;
        NSFileManager *files = NSFileManager.defaultManager;
        if (![files fileExistsAtPath:browser.path] ||
            ![files fileExistsAtPath:[extension stringByAppendingPathComponent:@"manifest.json"]]) {
            fail(@"The bundled browser or assistant extension is missing. Reinstall the complete application.");
        }
        NSURL *support = [files URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
        NSURL *profile = [support URLByAppendingPathComponent:@"AI Browser/Profile"];
        NSError *error = nil;
        if (![files createDirectoryAtURL:profile withIntermediateDirectories:YES
                             attributes:@{NSFilePosixPermissions: @0700} error:&error]) {
            fail([@"Could not create the browser profile: " stringByAppendingString:error.localizedDescription]);
        }
        NSWorkspaceOpenConfiguration *config = [NSWorkspaceOpenConfiguration configuration];
        config.createsNewApplicationInstance = YES;
        config.arguments = @[
            [@"--user-data-dir=" stringByAppendingString:profile.path],
            [@"--load-extension=" stringByAppendingString:extension],
            @"--no-first-run", @"--no-default-browser-check",
            @"chrome://newtab/"
        ];
        [NSWorkspace.sharedWorkspace openApplicationAtURL:browser configuration:config
            completionHandler:^(NSRunningApplication *running, NSError *launchError) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (launchError) fail(launchError.localizedDescription);
                    [app terminate:nil];
                });
            }];
        [app run];
    }
    return 0;
}
